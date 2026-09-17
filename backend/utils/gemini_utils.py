"""AI travel diary generation + landmark recognition via the Gemini API (free tier).

Requires GOOGLE_API_KEY in the environment (e.g. backend/.env). Get a free key at
aistudio.google.com/apikey, then either `export GOOGLE_API_KEY=...` before starting
uvicorn, or add it to backend/.env (loaded automatically via python-dotenv in main.py).
"""

import base64
import io
import logging
import os
import time
from typing import Optional

from google import genai
from google.genai import types
from PIL import Image
from pydantic import BaseModel

logger = logging.getLogger("gemini_utils")

MODEL = "gemini-3.5-flash-lite"

# Landmark photos are analyzed once and cached (see lib/photosApi.ts saveLandmarkResult),
# so this only bounds cost on the rare request that skips the client-side resize.
MAX_IMAGE_DIMENSION = 1024


class LandmarkResult(BaseModel):
    landmark: Optional[str]      # e.g. "Gyeongbokgung Palace", or null if none recognized
    confidence: str              # "high" | "medium" | "low"
    description: Optional[str]   # one short sentence, or null


def _client() -> genai.Client:
    if not os.environ.get("GOOGLE_API_KEY"):
        raise RuntimeError(
            "GOOGLE_API_KEY is not set — get a free key at aistudio.google.com/apikey "
            "and set it in the environment before calling this endpoint."
        )
    return genai.Client(api_key=os.environ["GOOGLE_API_KEY"])


def generate_travel_diary(entries: list[dict], language: str = "ko") -> str:
    """
    entries: one dict per photo, e.g.
      {"fileName": "IMG_1.jpg", "location": "Sokcho Beach", "captureDate": "2026-06-03",
       "captureTime": "11:56:35", "faceCount": 2}
    Returns a short first-person diary entry covering the whole set as one trip/day.
    """
    lines = []
    for e in entries:
        parts = [p for p in [e.get("captureDate"), e.get("captureTime"), e.get("location")] if p]
        if e.get("faceCount"):
            parts.append(f"{e['faceCount']} people in the photo")
        lines.append("- " + " / ".join(parts) if parts else f"- {e.get('fileName', 'photo')}")
    photo_summary = "\n".join(lines) if lines else "(no metadata available)"

    lang_instruction = "Write in Korean." if language == "ko" else f"Write in {language}."

    start = time.monotonic()
    try:
        client = _client()  # kept alive for the duration of the call — see recognize_landmark for why
        response = client.models.generate_content(
            model=MODEL,
            contents=f"Photos from this trip, in order:\n{photo_summary}",
            config=types.GenerateContentConfig(
                system_instruction=(
                    "You write short, warm first-person travel diary entries from a list of "
                    "photo metadata (date, time, location, how many people are in each photo). "
                    "Infer the flow of the trip from the order and locations. Do not invent "
                    "specific events, food, or feelings that aren't implied by the metadata — "
                    "keep it grounded but personable. 3-5 sentences. " + lang_instruction
                ),
                max_output_tokens=1024,
            ),
        )
    except Exception:
        logger.exception("generate_travel_diary failed after %.2fs (model=%s, photos=%d)", time.monotonic() - start, MODEL, len(entries))
        raise
    usage = response.usage_metadata
    logger.info(
        "generate_travel_diary ok in %.2fs — model=%s photos=%d input_tokens=%d output_tokens=%d",
        time.monotonic() - start, MODEL, len(entries),
        usage.prompt_token_count or 0, usage.candidates_token_count or 0,
    )
    return response.text or ""


def _resize_for_api(image_bytes: bytes, media_type: str) -> tuple[bytes, str]:
    """Downscale to MAX_IMAGE_DIMENSION on the longest side to bound token cost.
    Server-side safety net — the frontend already resizes before upload."""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.load()
    except Exception:
        return image_bytes, media_type  # not a decodable image — let the API reject it with a clear error
    if max(img.size) <= MAX_IMAGE_DIMENSION:
        return image_bytes, media_type
    img.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.LANCZOS)
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue(), "image/jpeg"


def recognize_landmark(
    image_bytes: bytes,
    media_type: str,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
) -> LandmarkResult:
    """Identify a famous landmark/building in a photo, if any."""
    image_bytes, media_type = _resize_for_api(image_bytes, media_type)
    location_hint = f" The photo was taken near ({lat}, {lng})." if lat is not None and lng is not None else ""

    start = time.monotonic()
    try:
        # Hold the Client in a variable (not `_client().models...` inline) — the SDK
        # retries the HTTP call from a worker thread, and an inline temporary can get
        # garbage-collected (closing its httpx client) before that thread runs,
        # raising "Cannot send a request, as the client has been closed."
        client = _client()
        response = client.models.generate_content(
            model=MODEL,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=media_type),
                (
                    "Is there a recognizable landmark, monument, or notable building in this photo?"
                    + location_hint +
                    " If yes, name it and rate your confidence. If no specific landmark is "
                    "recognizable (e.g. a generic street, beach, or indoor scene), set landmark to null."
                ),
            ],
            config=types.GenerateContentConfig(
                max_output_tokens=512,
                response_mime_type="application/json",
                response_schema=LandmarkResult,
            ),
        )
    except Exception:
        logger.exception("recognize_landmark failed after %.2fs (model=%s, bytes=%d)", time.monotonic() - start, MODEL, len(image_bytes))
        raise
    usage = response.usage_metadata
    result: LandmarkResult = response.parsed
    logger.info(
        "recognize_landmark ok in %.2fs — model=%s input_tokens=%d output_tokens=%d result=%r",
        time.monotonic() - start, MODEL,
        usage.prompt_token_count or 0, usage.candidates_token_count or 0, result.landmark,
    )
    return result

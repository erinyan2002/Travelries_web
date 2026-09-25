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

import httpx
from google import genai
from google.genai import errors, types
from PIL import Image
from pydantic import BaseModel

logger = logging.getLogger("gemini_utils")

# Tried in order; a busy/slow model falls through to the next one immediately
# instead of sleeping and retrying the same overloaded model. Benchmarked
# 2026-09-25 on the free tier: gemini-3.5-flash with minimal thinking answered a
# diary in ~1.7s, while gemini-3.5-flash-lite (the old sole model) took up to
# 110s or hit 503/504. `thinking_level` values are model-specific (flash-lite
# and newer flashes reject MINIMAL), so only the first entry sets one.
MODEL_CHAIN: list[tuple[str, Optional[types.ThinkingConfig]]] = [
    ("gemini-3.5-flash", types.ThinkingConfig(thinking_level="minimal")),
    ("gemini-3.5-flash-lite", None),
    ("gemini-3.1-flash-lite", None),
]
MODEL = MODEL_CHAIN[0][0]  # for logging

# Per-attempt HTTP timeout, so one stalled model can't hang the request —
# the next model in the chain gets a turn instead.
PER_CALL_TIMEOUT_MS = 12_000

# Landmark photos are analyzed once and cached (see lib/photosApi.ts saveLandmarkResult),
# so this only bounds cost on the rare request that skips the client-side resize.
MAX_IMAGE_DIMENSION = 1024

# Overload/rate-limit/timeout answers worth handing to the next model.
FALLTHROUGH_STATUS = {429, 500, 503, 504}


# A model that just 503'd/504'd/timed out is skipped for a while instead of
# being retried first on every request: on 2026-09-25 gemini-3.5-flash sat at
# ~15s-then-504 for an extended stretch while flash-lite answered in ~1s, so
# each diary paid a pointless 15s wait. The last model in the chain is never
# skipped, so there's always something to try.
MODEL_COOLDOWN_S = 300
_cooldown_until: dict[str, float] = {}


def _generate_with_fallback(client, *, config: types.GenerateContentConfig, **kwargs):
    """Runs generate_content down MODEL_CHAIN. Returns (response, model_name)."""
    last_exc: Exception | None = None
    now = time.monotonic()
    chain = [m for m in MODEL_CHAIN if _cooldown_until.get(m[0], 0) <= now] or MODEL_CHAIN[-1:]
    for model, thinking in chain:
        cfg = config.model_copy(update={
            "thinking_config": thinking,
            # No tools are passed, so automatic function calling is pure overhead.
            "automatic_function_calling": types.AutomaticFunctionCallingConfig(disable=True),
        })
        t = time.monotonic()
        try:
            return client.models.generate_content(model=model, config=cfg, **kwargs), model
        except errors.APIError as e:
            if getattr(e, "code", None) not in FALLTHROUGH_STATUS:
                raise
            last_exc = e
            _cooldown_until[model] = time.monotonic() + MODEL_COOLDOWN_S
            logger.warning("Gemini %s from %s after %.1fs — trying next model", e.code, model, time.monotonic() - t)
        except httpx.TimeoutException as e:
            last_exc = e
            _cooldown_until[model] = time.monotonic() + MODEL_COOLDOWN_S
            logger.warning("Gemini %s timed out after %.1fs — trying next model", model, time.monotonic() - t)
    assert last_exc is not None
    raise last_exc


def friendly_error(e: Exception) -> str:
    """User-facing message for a failed Gemini call (shown in the app)."""
    code = getattr(e, "code", None)
    if code in FALLTHROUGH_STATUS or isinstance(e, httpx.TimeoutException):
        return "The AI service is busy right now. Please try again in a minute."
    return str(e)


class LandmarkResult(BaseModel):
    landmark: Optional[str]      # e.g. "Gyeongbokgung Palace", or null if none recognized
    confidence: Optional[str] = None  # "high" | "medium" | "low"; null when no landmark
    description: Optional[str]   # one short sentence, or null


def _client() -> genai.Client:
    if not os.environ.get("GOOGLE_API_KEY"):
        raise RuntimeError(
            "GOOGLE_API_KEY is not set — get a free key at aistudio.google.com/apikey "
            "and set it in the environment before calling this endpoint."
        )
    return genai.Client(
        api_key=os.environ["GOOGLE_API_KEY"],
        http_options=types.HttpOptions(timeout=PER_CALL_TIMEOUT_MS),
    )


def generate_travel_diary(entries: list[dict], language: str = "ko") -> str:
    """
    entries: one dict per photo, e.g.
      {"fileName": "IMG_1.jpg", "location": "Sokcho Beach", "captureDate": "2026-06-03",
       "captureTime": "11:56:35", "faceCount": 2}
    Returns a short first-person diary entry covering the whole set as one trip/day.
    """
    def meta(e: dict) -> str:
        parts = [p for p in [e.get("captureDate"), e.get("captureTime"), e.get("location")] if p]
        if e.get("faceCount"):
            parts.append(f"{e['faceCount']} people in the photo")
        return " / ".join(parts) if parts else e.get("fileName", "photo")

    lang_name = {"ko": "Korean", "en": "English"}.get(language, language)

    # Show the model the photos themselves, not just metadata: two shots at the
    # same place and time are indistinguishable as text, so the diary used to
    # describe only one of them. Each photo is interleaved with its metadata.
    images = _fetch_diary_images(entries[:MAX_DIARY_IMAGES])
    contents: list = ["Photos from this trip, in order:"]
    for i, e in enumerate(entries):
        contents.append(f"Photo {i + 1}: {meta(e)}")
        img = images.get(i)
        if img:
            contents.append(types.Part.from_bytes(data=img[0], mime_type=img[1]))

    start = time.monotonic()
    try:
        client = _client()  # kept alive for the duration of the call — see recognize_landmark for why
        response, used_model = _generate_with_fallback(
            client,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=(
                    "You write short, warm first-person travel diary entries from a trip's photos "
                    "and their metadata (date, time, location, how many people). Go through the "
                    "trip in order and mention what EACH photo shows — every photo should be "
                    "reflected, not just the first. Describe only what is visible or implied; "
                    "don't invent names, food or events you can't see. "
                    f"{max(3, min(len(entries) + 2, 8))} sentences at most. Write in {lang_name}."
                ),
                max_output_tokens=1024,
            ),
        )
    except Exception:
        logger.exception("generate_travel_diary failed after %.2fs (photos=%d, images=%d)", time.monotonic() - start, len(entries), len(images))
        raise
    usage = response.usage_metadata
    logger.info(
        "generate_travel_diary ok in %.2fs — model=%s photos=%d images=%d input_tokens=%d output_tokens=%d",
        time.monotonic() - start, used_model, len(entries), len(images),
        usage.prompt_token_count or 0, usage.candidates_token_count or 0,
    )
    return response.text or ""


MAX_DIARY_IMAGES = 8
DIARY_IMAGE_DIM = 512  # small is plenty for "what's in the photo"


def _fetch_diary_images(entries: list[dict]) -> dict[int, tuple[bytes, str]]:
    """Downloads each entry's imageUrl (in parallel) and shrinks it. Only public
    Supabase Storage URLs are fetched — the URL comes from the browser, so this
    must not become a way to make the server request arbitrary addresses."""
    from concurrent.futures import ThreadPoolExecutor
    from urllib.parse import urlparse

    def one(i_e):
        i, e = i_e
        url = e.get("imageUrl") or ""
        u = urlparse(url)
        if u.scheme != "https" or not (u.hostname or "").endswith(".supabase.co") \
                or "/storage/v1/object/public/" not in u.path:
            return i, None
        try:
            r = httpx.get(url, timeout=8.0, follow_redirects=False)
            r.raise_for_status()
            return i, _resize_for_api(r.content, r.headers.get("content-type", "image/jpeg"), DIARY_IMAGE_DIM)
        except Exception as exc:  # a missing photo just means text-only for that one
            logger.warning("diary image %d fetch failed: %s", i, exc)
            return i, None

    with ThreadPoolExecutor(max_workers=4) as pool:
        return {i: img for i, img in pool.map(one, enumerate(entries)) if img}


def _resize_for_api(image_bytes: bytes, media_type: str, max_dim: int = MAX_IMAGE_DIMENSION) -> tuple[bytes, str]:
    """Downscale to max_dim on the longest side to bound token cost.
    Server-side safety net — the frontend already resizes before upload."""
    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.load()
    except Exception:
        return image_bytes, media_type  # not a decodable image — let the API reject it with a clear error
    if max(img.size) <= max_dim:
        return image_bytes, media_type
    img.thumbnail((max_dim, max_dim), Image.LANCZOS)
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
        response, used_model = _generate_with_fallback(
            client,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=media_type),
                (
                    "Is there a recognizable landmark, monument, or notable building in this photo?"
                    + location_hint +
                    " If yes, name it and rate your confidence. If no specific landmark is "
                    "recognizable (e.g. a generic street, beach, or indoor scene), set landmark to null."
                    ' Reply with ONLY this JSON: {"landmark": string or null, '
                    '"confidence": "high" | "medium" | "low" | null, "description": one short sentence or null}'
                ),
            ],
            # JSON mode WITHOUT response_schema: with a schema attached,
            # gemini-3.5-flash stalled past 90s on a photo it answered in ~3s
            # as plain JSON (measured 2026-09-25). Shape is validated below instead.
            config=types.GenerateContentConfig(
                max_output_tokens=512,
                response_mime_type="application/json",
            ),
        )
    except Exception:
        logger.exception("recognize_landmark failed after %.2fs (model=%s, bytes=%d)", time.monotonic() - start, MODEL, len(image_bytes))
        raise
    usage = response.usage_metadata
    result = LandmarkResult.model_validate_json(response.text or "{}")
    logger.info(
        "recognize_landmark ok in %.2fs — model=%s input_tokens=%d output_tokens=%d result=%r",
        time.monotonic() - start, used_model,
        usage.prompt_token_count or 0, usage.candidates_token_count or 0, result.landmark,
    )
    return result

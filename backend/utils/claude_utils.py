"""AI travel diary generation + landmark recognition via the Claude API.

Requires ANTHROPIC_API_KEY in the environment (e.g. backend/.env). Get a key at
console.anthropic.com > API Keys, then either `export ANTHROPIC_API_KEY=...`
before starting uvicorn, or add it to backend/.env and load it with
python-dotenv (add `from dotenv import load_dotenv; load_dotenv()` near the
top of main.py if you go that route — not wired up by default here).
"""

import base64
import os
from typing import Optional

import anthropic
from pydantic import BaseModel

MODEL = "claude-opus-5"


class LandmarkResult(BaseModel):
    landmark: Optional[str]      # e.g. "Gyeongbokgung Palace", or null if none recognized
    confidence: str              # "high" | "medium" | "low"
    description: Optional[str]   # one short sentence, or null


def _client() -> anthropic.Anthropic:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set — get one at console.anthropic.com "
            "and set it in the environment before calling this endpoint."
        )
    return anthropic.Anthropic()


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

    response = _client().messages.create(
        model=MODEL,
        max_tokens=1024,
        system=(
            "You write short, warm first-person travel diary entries from a list of "
            "photo metadata (date, time, location, how many people are in each photo). "
            "Infer the flow of the trip from the order and locations. Do not invent "
            "specific events, food, or feelings that aren't implied by the metadata — "
            "keep it grounded but personable. 3-5 sentences. " + lang_instruction
        ),
        messages=[{"role": "user", "content": f"Photos from this trip, in order:\n{photo_summary}"}],
    )
    return next((b.text for b in response.content if b.type == "text"), "")


def recognize_landmark(
    image_bytes: bytes,
    media_type: str,
    lat: Optional[float] = None,
    lng: Optional[float] = None,
) -> LandmarkResult:
    """Identify a famous landmark/building in a photo, if any."""
    image_b64 = base64.standard_b64encode(image_bytes).decode("utf-8")
    location_hint = f" The photo was taken near ({lat}, {lng})." if lat is not None and lng is not None else ""

    response = _client().messages.parse(
        model=MODEL,
        max_tokens=512,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_b64}},
                {"type": "text", "text": (
                    "Is there a recognizable landmark, monument, or notable building in this photo?"
                    + location_hint +
                    " If yes, name it and rate your confidence. If no specific landmark is "
                    "recognizable (e.g. a generic street, beach, or indoor scene), set landmark to null."
                )},
            ],
        }],
        output_format=LandmarkResult,
    )
    return response.parsed_output

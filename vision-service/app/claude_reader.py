"""Claude vision as an independent, verbatim transcriber.

Claude is a strong reader but a generative model: on a blurry word it tends
to output the most *plausible* word. So it is used only as a second
opinion. It is asked for an exact transcription with illegible parts marked,
and its words are compared against the OCR consensus. It never overrides
OCR on its own; a disagreement becomes a "conflicting" word for the user.
"""

import base64
import os
import re

from app.imaging import encode_jpeg

PROMPT_VERSION = "transcribe.v1"
MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5-5")
ILLEGIBLE = "⟦?⟧"

SYSTEM = f"""You transcribe text from photos of food packaging, exactly as printed.

Rules:
- Copy the ingredients list and any allergen statements ("Contains...", "May contain...") character for character, keeping the printed spelling, punctuation, brackets, numbers and line breaks.
- Do NOT correct spelling, expand abbreviations, translate, or complete words.
- If any character or word cannot be read with confidence, write {ILLEGIBLE} in its place instead of guessing. A partly readable word like "emul" followed by unreadable letters is written "emul{ILLEGIBLE}".
- If text runs off the edge of the photo, end with {ILLEGIBLE}.
- Ignore other text on the pack (brand, nutrition table, address) unless it is part of the ingredients or allergen statements.
- Output only the transcription, no commentary. If there is no ingredients list, output nothing."""


def is_configured() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


_client = None


def client():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic(timeout=45.0, max_retries=1)
    return _client


def transcribe(img) -> str | None:
    """Return Claude's verbatim transcription, or None if unavailable/declined."""
    if not is_configured():
        return None
    data = base64.standard_b64encode(encode_jpeg(img, 90)).decode()
    resp = client().messages.create(
        model=MODEL,
        max_tokens=4000,
        system=SYSTEM,
        output_config={"effort": "medium"},
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": data}},
                {"type": "text", "text": "Transcribe the ingredients list and allergen statements."},
            ],
        }],
    )
    if resp.stop_reason == "refusal":
        return None
    return "".join(b.text for b in resp.content if b.type == "text").strip()


def words(transcription: str) -> list[str]:
    """Split into words; illegible markers stay attached so partial words
    like 'emul⟦?⟧' are kept as one (unreadable) word."""
    return re.sub(r"\s+", " ", transcription).strip().split(" ") if transcription.strip() else []

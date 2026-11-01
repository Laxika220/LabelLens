"""LabelLens vision service.

Called only by the Next.js server (never directly by browsers), which holds
the shared token. Photos are processed in memory and discarded; nothing
about the image or its text is logged.
"""

import hmac
import os
import time
from collections import defaultdict

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool

from app import quality
from app.imaging import MAX_BYTES, ImageError, decode

app = FastAPI(title="LabelLens vision service", docs_url=None, redoc_url=None)

TOKEN = os.environ.get("VISION_SERVICE_TOKEN", "")
RATE_LIMIT = int(os.environ.get("VISION_RATE_LIMIT", "60"))  # requests per IP per 10 min
_hits: dict[str, list[float]] = defaultdict(list)


def guard(request: Request, x_service_token: str = Header(default="")):
    if TOKEN and not hmac.compare_digest(x_service_token, TOKEN):
        raise HTTPException(401, "unauthorised")
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "local").split(",")[0]
    now = time.time()
    recent = [t for t in _hits[ip] if now - t < 600]
    if len(recent) >= RATE_LIMIT:
        raise HTTPException(429, "Too many requests. Try again in a few minutes.")
    recent.append(now)
    _hits[ip] = recent


async def read_image(image: UploadFile):
    if image.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(415, "Upload a JPEG, PNG or WebP photo.")
    data = await image.read(MAX_BYTES + 1)
    try:
        return decode(data)
    except ImageError as e:
        raise HTTPException(422, str(e)) from None


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/assess", dependencies=[Depends(guard)])
async def assess(image: UploadFile = File(...)):
    img = await read_image(image)
    report = await run_in_threadpool(quality.assess, img)
    return report.to_dict()

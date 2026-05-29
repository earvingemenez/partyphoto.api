import asyncio
import io
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:
    pass

ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = ROOT / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_BYTES = 12 * 1024 * 1024
WEBP_QUALITY = int(os.environ.get("WEBP_QUALITY", "82"))
JPEG_QUALITY = int(os.environ.get("JPEG_QUALITY", "90"))
ALLOWED_RE = re.compile(r"\.(jpe?g|png|webp|gif|heic|heif|avif|tiff?)$", re.IGNORECASE)


class CachedStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


app = FastAPI(title="Party Photos API")
app.mount("/uploads", CachedStaticFiles(directory=UPLOAD_DIR), name="uploads")


_subscribers: set[asyncio.Queue] = set()


async def broadcast(event_type: str, payload: dict[str, Any]) -> None:
    message = f"event: {event_type}\ndata: {json.dumps(payload)}\n\n"
    for queue in list(_subscribers):
        try:
            queue.put_nowait(message)
        except asyncio.QueueFull:
            pass


@app.get("/api/events")
async def events():
    queue: asyncio.Queue = asyncio.Queue(maxsize=64)
    _subscribers.add(queue)

    async def stream():
        try:
            yield ": connected\n\n"
            while True:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield message
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            _subscribers.discard(queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def list_photos():
    items = []
    for entry in UPLOAD_DIR.iterdir():
        if not entry.is_file() or entry.suffix.lower() != ".webp":
            continue
        stat = entry.stat()
        created = getattr(stat, "st_birthtime", None) or stat.st_mtime
        items.append(
            {
                "id": entry.name,
                "url": f"/uploads/{entry.name}",
                "createdAt": int(created * 1000),
            }
        )
    items.sort(key=lambda p: p["createdAt"], reverse=True)
    return items


@app.get("/api/photos")
def get_photos():
    return list_photos()


@app.post("/api/photos", status_code=201)
async def create_photo(photo: UploadFile = File(...)):
    name = photo.filename or ""
    content_type = (photo.content_type or "").lower()
    type_ok = content_type.startswith("image/") or ALLOWED_RE.search(name)
    if not type_ok:
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    data = await photo.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large")
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload")

    filename = f"{uuid.uuid4()}.webp"
    out_path = UPLOAD_DIR / filename

    try:
        with Image.open(io.BytesIO(data)) as img:
            img = ImageOps.exif_transpose(img)
            if img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
            img.save(out_path, format="WEBP", quality=WEBP_QUALITY, method=4)
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=415, detail="Could not process image") from exc

    stat = out_path.stat()
    created = getattr(stat, "st_birthtime", None) or stat.st_mtime
    photo = {
        "id": filename,
        "url": f"/uploads/{filename}",
        "createdAt": int(created * 1000),
    }
    await broadcast("created", photo)
    return JSONResponse(status_code=201, content=photo)


@app.get("/api/photos/{photo_id}/download")
def download_photo(photo_id: str):
    if "/" in photo_id or ".." in photo_id or photo_id != os.path.basename(photo_id):
        raise HTTPException(status_code=400, detail="Invalid id")
    source = UPLOAD_DIR / photo_id
    if not source.exists():
        raise HTTPException(status_code=404, detail="Not found")

    buf = io.BytesIO()
    try:
        with Image.open(source) as img:
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=500, detail="Could not convert image") from exc

    buf.seek(0)
    jpeg_name = f"{source.stem}.jpg"
    return StreamingResponse(
        buf,
        media_type="image/jpeg",
        headers={"Content-Disposition": f'attachment; filename="{jpeg_name}"'},
    )


@app.delete("/api/photos/{photo_id}", status_code=204)
async def delete_photo(photo_id: str):
    if "/" in photo_id or ".." in photo_id or photo_id != os.path.basename(photo_id):
        raise HTTPException(status_code=400, detail="Invalid id")
    target = UPLOAD_DIR / photo_id
    if not target.exists():
        raise HTTPException(status_code=404, detail="Not found")
    target.unlink()
    await broadcast("deleted", {"id": photo_id})
    return Response(status_code=204)

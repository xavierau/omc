"""Image download utility."""

import httpx

_TIMEOUT = 30.0
_IMAGE_MAGIC = {
    b"\xff\xd8\xff": "jpeg",
    b"\x89PNG": "png",
    b"GIF8": "gif",
    b"RIFF": "webp",
}


async def download_image(url: str, max_size_mb: int = 10) -> bytes:
    """Download image from URL with size and type validation."""
    max_bytes = max_size_mb * 1024 * 1024
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.get(url)
        response.raise_for_status()
        _check_size(response, max_bytes)
        data = response.content
        _check_is_image(data)
        return data


def _check_size(response: httpx.Response, max_bytes: int) -> None:
    """Raise ValueError if content exceeds max size."""
    length = response.headers.get("content-length")
    if length and int(length) > max_bytes:
        raise ValueError(f"Image too large: {length} bytes")
    if len(response.content) > max_bytes:
        raise ValueError(f"Image too large: {len(response.content)} bytes")


def _check_is_image(data: bytes) -> None:
    """Raise ValueError if data doesn't look like an image."""
    if len(data) < 4:
        raise ValueError("Response too small to be an image")
    for magic in _IMAGE_MAGIC:
        if data[:len(magic)] == magic:
            return
    raise ValueError("Response is not a recognized image format")

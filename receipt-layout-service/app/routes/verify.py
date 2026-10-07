"""Verify a receipt image against a template."""

import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request

from app.models.requests import VerifyRequest, VerifyResponse
from app.services.comparator import compare_layout
from app.services.sanitizer import sanitize_receipt_image
from app.utils.image import download_image

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/verify")
async def verify(body: VerifyRequest, request: Request) -> VerifyResponse:
    """Download, sanitize, detect, and compare against template."""
    settings = request.app.state.settings
    detector = request.app.state.detector
    image_bytes = await _download(body.image_url, settings.max_image_size_mb)
    result = await asyncio.to_thread(sanitize_receipt_image, image_bytes)
    h, w = result.image.shape[:2]
    aspect_ratio = w / h if h > 0 else 1.0
    regions = await asyncio.to_thread(detector.detect, result.image)
    verification = compare_layout(regions, aspect_ratio, body.template, body.threshold)
    logger.info("Verified receipt", extra={"data": {"score": verification.score}})
    return VerifyResponse(
        score=verification.score,
        passed=verification.passed,
        details=verification,
    )


async def _download(url: str, max_mb: int) -> bytes:
    try:
        return await download_image(url, max_mb)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

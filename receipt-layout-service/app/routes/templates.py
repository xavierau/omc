"""Build a layout template from sample images."""

import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request

from app.models.requests import BuildTemplateRequest, BuildTemplateResponse
from app.services.sanitizer import sanitize_receipt_image
from app.services.template_builder import build_template
from app.utils.image import download_image

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/templates/build")
async def build(body: BuildTemplateRequest, request: Request) -> BuildTemplateResponse:
    """Download sample images, detect regions, build template."""
    settings = request.app.state.settings
    detector = request.app.state.detector
    images = await _download_all(body.image_urls, settings.max_image_size_mb)
    all_detections, aspect_ratios = await _process_samples(images, detector)
    template = build_template(all_detections, aspect_ratios)
    logger.info("Built template", extra={"data": {"samples": len(images)}})
    return BuildTemplateResponse(template=template, sample_count=len(images))


async def _download_all(urls: list[str], max_mb: int) -> list[bytes]:
    try:
        tasks = [download_image(u, max_mb) for u in urls]
        return await asyncio.gather(*tasks)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


async def _process_samples(images, detector):  # noqa: ANN001
    all_detections = []
    aspect_ratios = []
    for img_bytes in images:
        result = await asyncio.to_thread(sanitize_receipt_image, img_bytes)
        h, w = result.image.shape[:2]
        aspect_ratios.append(w / h if h > 0 else 1.0)
        regions = await asyncio.to_thread(detector.detect, result.image)
        all_detections.append(regions)
    return all_detections, aspect_ratios

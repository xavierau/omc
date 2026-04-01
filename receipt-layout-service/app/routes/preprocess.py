"""Preprocess (sanitize) a receipt image."""

import asyncio
import base64
import logging

import cv2
import numpy as np
from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from app.models.requests import PreprocessRequest, PreprocessResponse
from app.services.sanitizer import sanitize_receipt_image
from app.utils.image import download_image

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/preprocess")
async def preprocess(body: PreprocessRequest, request: Request) -> PreprocessResponse:
    """Download, sanitize, and return cleaned image."""
    settings = request.app.state.settings
    image_bytes = await _download(body.image_url, settings.max_image_size_mb)
    result = await asyncio.to_thread(sanitize_receipt_image, image_bytes)
    jpeg_b64 = _encode_jpeg_base64(result.image)
    logger.info("Preprocessed image", extra={"data": {"method": result.method}})
    return PreprocessResponse(
        cleaned_image_base64=jpeg_b64,
        method=result.method,
        corners_detected=result.corners_detected,
    )


@router.post("/preprocess/upload")
async def preprocess_upload(file: UploadFile = File(...)) -> PreprocessResponse:
    """Accept file upload, sanitize, and return cleaned image."""
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty file")
    result = await asyncio.to_thread(sanitize_receipt_image, image_bytes)
    jpeg_b64 = _encode_jpeg_base64(result.image)
    logger.info("Preprocessed uploaded image", extra={"data": {"method": result.method}})
    return PreprocessResponse(
        cleaned_image_base64=jpeg_b64,
        method=result.method,
        corners_detected=result.corners_detected,
    )


async def _download(url: str, max_mb: int) -> bytes:
    try:
        return await download_image(url, max_mb)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _encode_jpeg_base64(image: np.ndarray) -> str:
    _, buf = cv2.imencode(".jpg", image)
    return base64.b64encode(buf.tobytes()).decode("ascii")

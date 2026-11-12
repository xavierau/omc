"""Receipt image sanitization pipeline.

Pure image processing: bytes in, clean image out.
No HTTP, no DB, no external services.
"""

from typing import Optional

import cv2
import numpy as np

from app.models.sanitize_result import SanitizeResult
from app.services.image_processing import (
    apply_exif_rotation,
    apply_perspective_correction,
    enhance_contrast,
    remove_shadows,
    resize_for_detection,
    resize_to_standard,
)
from app.utils.geometry import order_points

# Re-export for public API (used by tests and routes)
SanitizeResult = SanitizeResult
apply_exif_rotation = apply_exif_rotation
apply_perspective_correction = apply_perspective_correction
enhance_contrast = enhance_contrast
remove_shadows = remove_shadows
resize_for_detection = resize_for_detection
resize_to_standard = resize_to_standard

_MIN_AREA_RATIO = 0.15
_MAX_AREA_RATIO = 0.85

_sam_segmenter = None


def set_sam_segmenter(segmenter) -> None:
    """Inject SAM segmenter instance from application startup."""
    global _sam_segmenter  # noqa: PLW0603
    _sam_segmenter = segmenter


def detect_receipt_boundary_sam(
    image: np.ndarray, sam_session=None,
) -> Optional[np.ndarray]:
    """Detect receipt corners via EfficientSAM. None if unavailable."""
    if sam_session is None:
        return None
    return sam_session.segment_to_corners(image)


def detect_receipt_boundary_opencv(
    image: np.ndarray,
) -> Optional[np.ndarray]:
    """Detect receipt corners using L-channel thresholding.

    Returns (4, 2) ordered corners [TL, TR, BR, BL] or None.
    """
    h, w = image.shape[:2]
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_ch = lab[:, :, 0]
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))

    for thresh in [200, 190, 180, 170, 160]:
        cnt = _find_valid_contour(l_ch, thresh, kernel, h * w)
        if cnt is None:
            continue
        corners = _contour_to_corners(cnt)
        if corners is not None:
            return corners
    return None


def sanitize_receipt_image(image_bytes: bytes) -> SanitizeResult:
    """Full preprocessing pipeline: rotate, crop, clean."""
    full = apply_exif_rotation(image_bytes)
    original_size = (full.shape[1], full.shape[0])
    cropped, method = _detect_and_crop(full)
    cropped = remove_shadows(cropped)
    cropped = enhance_contrast(cropped)
    cropped = resize_to_standard(cropped)
    cleaned_size = (cropped.shape[1], cropped.shape[0])
    return SanitizeResult(
        image=cropped, method=method,
        corners_detected=method != "original",
        original_size=original_size, cleaned_size=cleaned_size,
    )


def _detect_and_crop(image):
    if _sam_segmenter and _sam_segmenter.is_loaded():
        corners = detect_receipt_boundary_sam(image, _sam_segmenter)
        if corners is not None:
            return apply_perspective_correction(image, corners), "efficient_sam"
    corners = detect_receipt_boundary_opencv(image)
    if corners is not None:
        return apply_perspective_correction(image, corners), "opencv"
    return image, "original"


def _find_valid_contour(l_ch, thresh, kernel, img_area):
    _, mask = cv2.threshold(l_ch, thresh, 255, cv2.THRESH_BINARY)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    contours, _ = cv2.findContours(
        mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE,
    )
    if not contours:
        return None
    cnt = max(contours, key=cv2.contourArea)
    ratio = cv2.contourArea(cnt) / img_area
    if ratio < _MIN_AREA_RATIO or ratio > _MAX_AREA_RATIO:
        return None
    return cnt


def _contour_to_corners(cnt):
    peri = cv2.arcLength(cnt, True)
    for eps in [0.02, 0.03, 0.04, 0.05]:
        approx = cv2.approxPolyDP(cnt, eps * peri, True)
        if len(approx) == 4:
            return order_points(approx.reshape(4, 2))
    rect = cv2.minAreaRect(cnt)
    rw, rh = rect[1]
    if min(rw, rh) == 0:
        return None
    box = cv2.boxPoints(rect).astype(np.float32)
    return order_points(box)

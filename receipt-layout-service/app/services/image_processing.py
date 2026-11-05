"""Stateless image processing functions for receipt cleanup."""

from io import BytesIO

import cv2
import numpy as np
from PIL import Image, ImageOps


def apply_exif_rotation(image_bytes: bytes) -> np.ndarray:
    """Handle phone camera rotation via EXIF, return BGR numpy array."""
    pil_img = Image.open(BytesIO(image_bytes))
    pil_img = ImageOps.exif_transpose(pil_img)
    rgb = np.array(pil_img.convert("RGB"))
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def resize_for_detection(
    image: np.ndarray, max_width: int = 500
) -> tuple[np.ndarray, float]:
    """Resize to max_width for fast detection. Returns (resized, scale)."""
    h, w = image.shape[:2]
    if w <= max_width:
        return image, 1.0
    scale = max_width / w
    new_h = int(h * scale)
    resized = cv2.resize(image, (max_width, new_h), interpolation=cv2.INTER_AREA)
    return resized, scale


def apply_perspective_correction(
    image: np.ndarray, corners: np.ndarray
) -> np.ndarray:
    """Warp perspective so receipt fills a rectangle."""
    dst_w, dst_h = _compute_destination_size(corners)
    dst = np.array([
        [0, 0], [dst_w - 1, 0],
        [dst_w - 1, dst_h - 1], [0, dst_h - 1],
    ], dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(corners, dst)
    return cv2.warpPerspective(
        image, matrix, (dst_w, dst_h), flags=cv2.INTER_CUBIC
    )


def _compute_destination_size(
    corners: np.ndarray,
) -> tuple[int, int]:
    """Compute output width/height preserving aspect ratio."""
    tl, tr, br, bl = corners
    w_top = np.linalg.norm(tr - tl)
    w_bot = np.linalg.norm(br - bl)
    h_left = np.linalg.norm(bl - tl)
    h_right = np.linalg.norm(br - tr)
    return int(max(w_top, w_bot)), int(max(h_left, h_right))


def remove_shadows(image: np.ndarray) -> np.ndarray:
    """Remove uneven lighting / shadows from receipt image."""
    gray = _to_grayscale(image)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    dilated = cv2.dilate(gray, kernel)
    background = cv2.medianBlur(dilated, 21)
    shadow_free = 255 - cv2.absdiff(gray, background)
    normalized = cv2.normalize(
        shadow_free, None, 0, 255, cv2.NORM_MINMAX
    )
    return cv2.merge([normalized, normalized, normalized])


def _to_grayscale(image: np.ndarray) -> np.ndarray:
    """Convert to grayscale, handling both BGR and single-channel."""
    if image.ndim == 3 and image.shape[2] == 3:
        return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return image


def enhance_contrast(image: np.ndarray) -> np.ndarray:
    """Apply CLAHE contrast enhancement."""
    gray = _to_grayscale(image)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    return cv2.merge([enhanced, enhanced, enhanced])


def resize_to_standard(
    image: np.ndarray, target_width: int = 1000
) -> np.ndarray:
    """Resize to standard width maintaining aspect ratio."""
    h, w = image.shape[:2]
    scale = target_width / w
    new_h = int(h * scale)
    interp = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
    return cv2.resize(image, (target_width, new_h), interpolation=interp)

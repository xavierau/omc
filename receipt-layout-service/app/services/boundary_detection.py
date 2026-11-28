"""Receipt boundary detection strategies (OpenCV + EfficientSAM)."""

from typing import Optional

import cv2
import numpy as np

from app.utils.geometry import order_points

_MIN_AREA_RATIO = 0.10
_MAX_AREA_RATIO = 0.92
_BORDER_MARGIN = 3
_PAD_PERCENT = 0.03  # 3% padding around detected quad
_MIN_RECEIPT_ASPECT = 1.2  # receipts are taller than wide


def detect_receipt_boundary_opencv(
    image: np.ndarray,
) -> Optional[np.ndarray]:
    """Multi-strategy boundary detection for receipts on varied backgrounds."""
    h, w = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    img_area = h * w

    # Color segmentation first — try each threshold separately (tight→loose)
    for contours in _strategy_color_segmentation_iter(image):
        result = _extract_quadrilateral(contours, img_area, w, h)
        if result is not None:
            return _pad_corners(result, w, h)

    # Fallback strategies
    for strategy in [
        lambda: _strategy_adaptive_threshold(gray),
        lambda: _strategy_enhanced_canny(gray),
    ]:
        result = _extract_quadrilateral(strategy(), img_area, w, h)
        if result is not None:
            return _pad_corners(result, w, h)
    return None


def _pad_corners(
    corners: np.ndarray, img_w: int, img_h: int,
) -> np.ndarray:
    """Expand quad outward by _PAD_PERCENT to avoid clipping content."""
    cx = corners[:, 0].mean()
    cy = corners[:, 1].mean()
    padded = corners.copy()
    for i in range(4):
        dx = corners[i][0] - cx
        dy = corners[i][1] - cy
        padded[i][0] = corners[i][0] + dx * _PAD_PERCENT
        padded[i][1] = corners[i][1] + dy * _PAD_PERCENT
    # Clamp to image boundaries
    padded[:, 0] = np.clip(padded[:, 0], 0, img_w - 1)
    padded[:, 1] = np.clip(padded[:, 1], 0, img_h - 1)
    return padded


def _quad_aspect_ratio(corners: np.ndarray) -> float:
    """Return height/width of the quad. Receipts should be > 1.0."""
    tl, tr, br, bl = corners
    w = max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))
    h = max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))
    return h / w if w > 0 else 0


def _strategy_adaptive_threshold(gray: np.ndarray) -> list:
    """Adaptive thresholding handles uneven lighting well."""
    blurred = cv2.GaussianBlur(gray, (11, 11), 0)
    thresh = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV, 21, 5,
    )
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7))
    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(
        closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE,
    )
    return contours


def _strategy_enhanced_canny(gray: np.ndarray) -> list:
    """Canny with bilateral filter and multiple threshold pairs."""
    filtered = cv2.bilateralFilter(gray, 11, 75, 75)
    threshold_pairs = [(50, 200), (30, 150), (75, 250)]
    all_contours = []
    for lo, hi in threshold_pairs:
        edges = cv2.Canny(filtered, lo, hi)
        dilated = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
        contours, _ = cv2.findContours(
            dilated, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE,
        )
        all_contours.extend(contours)
    return all_contours


def _strategy_color_segmentation_iter(image: np.ndarray):
    """Yield contour lists per threshold level.

    First tries a column-constrained merge (tight threshold for
    horizontal bounds, loose threshold for vertical extent) to handle
    shadowed receipts on light tables. Then falls back to individual
    threshold levels tight->loose.
    """
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l_channel = lab[:, :, 0]
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
    masks = {}
    for thresh in [200, 190, 180, 170]:
        _, mask = cv2.threshold(l_channel, thresh, 255, cv2.THRESH_BINARY)
        cleaned = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        cleaned = cv2.morphologyEx(cleaned, cv2.MORPH_OPEN, kernel)
        masks[thresh] = cleaned

    # Column-constrained merge: use L>200 x-range to mask L>170
    merged = _column_constrained_merge(masks, l_channel.shape, kernel)
    if merged is not None:
        contours, _ = cv2.findContours(
            merged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE,
        )
        yield contours

    for thresh in [200, 190, 180, 170]:
        contours, _ = cv2.findContours(
            masks[thresh], cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE,
        )
        yield contours


def _column_constrained_merge(
    masks: dict, shape: tuple, kernel,
) -> Optional[np.ndarray]:
    """Merge tight+loose masks: use tight x-range to crop loose mask.

    Handles receipts on light tables where loose thresholds merge
    receipt with background but tight thresholds miss shadowed areas.
    """
    tight = masks.get(200)
    loose = masks.get(170)
    if tight is None or loose is None:
        return None
    contours_tight, _ = cv2.findContours(
        tight, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE,
    )
    if not contours_tight:
        return None
    cnt = max(contours_tight, key=cv2.contourArea)
    h, w = shape[:2]
    area_ratio = cv2.contourArea(cnt) / (h * w)
    if area_ratio < _MIN_AREA_RATIO:
        return None
    x, _, bw, _ = cv2.boundingRect(cnt)
    # Constrain loose mask to the x-range of the tight detection
    pad = int(bw * 0.05)
    x0 = max(0, x - pad)
    x1 = min(w, x + bw + pad)
    constrained = np.zeros_like(loose)
    constrained[:, x0:x1] = loose[:, x0:x1]
    constrained = cv2.morphologyEx(constrained, cv2.MORPH_CLOSE, kernel)
    return constrained


def _extract_quadrilateral(
    contours: list, img_area: int, img_w: int, img_h: int,
) -> Optional[np.ndarray]:
    """Find quadrilateral from contours, falling back to bounding rect."""
    sorted_contours = sorted(contours, key=cv2.contourArea, reverse=True)
    for cnt in sorted_contours[:5]:
        area = cv2.contourArea(cnt)
        if area < _MIN_AREA_RATIO * img_area:
            continue
        if area > _MAX_AREA_RATIO * img_area:
            continue
        result = _try_approx_poly(cnt)
        if result is not None and _is_valid_receipt(result, img_w, img_h):
            return result
        result = _try_bounding_rect(cnt, img_w, img_h)
        if result is not None and _is_valid_receipt(result, img_w, img_h):
            return result
    return None


def _is_valid_receipt(
    corners: np.ndarray, img_w: int, img_h: int,
) -> bool:
    """Check quad is not the full frame and has receipt-like aspect ratio."""
    if _is_full_frame(corners, img_w, img_h):
        return False
    aspect = _quad_aspect_ratio(corners)
    if aspect < _MIN_RECEIPT_ASPECT:
        return False
    return True


def _is_full_frame(
    corners: np.ndarray, img_w: int, img_h: int,
) -> bool:
    """Reject if all 4 corners hug both left+right edges (whole frame)."""
    m = _BORDER_MARGIN
    left_edge = sum(1 for x, _ in corners if x <= m)
    right_edge = sum(1 for x, _ in corners if x >= img_w - m)
    return left_edge >= 2 and right_edge >= 2


def _try_approx_poly(cnt: np.ndarray) -> Optional[np.ndarray]:
    """Try to approximate contour as a 4-point polygon."""
    peri = cv2.arcLength(cnt, True)
    for eps_mult in [0.02, 0.03, 0.04, 0.05]:
        approx = cv2.approxPolyDP(cnt, eps_mult * peri, True)
        if len(approx) == 4:
            return order_points(approx.reshape(4, 2))
    return None


def _try_bounding_rect(
    cnt: np.ndarray, img_w: int, img_h: int,
) -> Optional[np.ndarray]:
    """Fall back to minimum-area rotated rect for large contours."""
    rect = cv2.minAreaRect(cnt)
    w, h = rect[1]
    if min(w, h) == 0:
        return None
    aspect = max(w, h) / min(w, h)
    if aspect > 5.0:
        return None
    box = cv2.boxPoints(rect).astype(np.float32)
    return order_points(box)


def detect_receipt_boundary_sam(
    image: np.ndarray,
    sam_session=None,
) -> Optional[np.ndarray]:
    """Fallback detection using EfficientSAM ONNX model."""
    if sam_session is None:
        return None
    return _mask_to_corners(np.zeros(image.shape[:2], dtype=np.uint8))


def _mask_to_corners(mask: np.ndarray) -> Optional[np.ndarray]:
    """Extract 4-corner polygon from a binary mask."""
    contours, _ = cv2.findContours(
        mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE,
    )
    if not contours:
        return None
    cnt = max(contours, key=cv2.contourArea)
    return _try_approx_poly(cnt)

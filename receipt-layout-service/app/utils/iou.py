"""Intersection over Union computation for normalized bounding boxes."""

from __future__ import annotations

from app.models.layout import NormBBox


def compute_iou(a: NormBBox, b: NormBBox) -> float:
    """Compute Intersection over Union of two normalized bounding boxes."""
    x_left = max(a.x, b.x)
    y_top = max(a.y, b.y)
    x_right = min(a.x + a.w, b.x + b.w)
    y_bottom = min(a.y + a.h, b.y + b.h)

    if x_right <= x_left or y_bottom <= y_top:
        return 0.0

    intersection = (x_right - x_left) * (y_bottom - y_top)
    area_a = a.w * a.h
    area_b = b.w * b.h
    union = area_a + area_b - intersection

    if union <= 0.0:
        return 0.0

    return intersection / union

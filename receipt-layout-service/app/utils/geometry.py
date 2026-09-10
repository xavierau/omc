"""Geometry utilities for receipt boundary detection."""

import numpy as np


def order_points(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as: top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).flatten()

    rect[0] = pts[s.argmin()]       # top-left: smallest sum
    rect[2] = pts[s.argmax()]       # bottom-right: largest sum
    rect[1] = pts[d.argmin()]       # top-right: smallest diff
    rect[3] = pts[d.argmax()]       # bottom-left: largest diff
    return rect

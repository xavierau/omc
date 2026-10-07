"""Tests for multi-strategy receipt boundary detection."""

import cv2
import numpy as np
import pytest

from app.services.boundary_detection import (
    detect_receipt_boundary_opencv,
    detect_receipt_boundary_sam,
)


def _make_receipt_on_table(
    img_w=800, img_h=600, receipt_color=240, bg_color=120,
) -> np.ndarray:
    """Create a synthetic image: white rectangle on darker background."""
    img = np.full((img_h, img_w, 3), bg_color, dtype=np.uint8)
    # Draw a white receipt-like rectangle (slightly inset)
    x1, y1, x2, y2 = 150, 80, 650, 520
    cv2.rectangle(img, (x1, y1), (x2, y2), (receipt_color,) * 3, -1)
    return img


class TestDetectReceiptBoundaryOpencv:
    def test_detects_white_receipt_on_dark_background(self):
        img = _make_receipt_on_table()
        result = detect_receipt_boundary_opencv(img)
        assert result is not None
        assert result.shape == (4, 2)

    def test_returns_ordered_corners(self):
        img = _make_receipt_on_table()
        corners = detect_receipt_boundary_opencv(img)
        assert corners is not None
        # top-left should have smallest sum
        sums = corners.sum(axis=1)
        assert sums[0] == sums.min()
        # bottom-right should have largest sum
        assert sums[2] == sums.max()

    def test_returns_none_for_uniform_image(self):
        img = np.full((600, 800, 3), 128, dtype=np.uint8)
        result = detect_receipt_boundary_opencv(img)
        assert result is None

    def test_returns_none_for_tiny_contour(self):
        img = np.full((600, 800, 3), 128, dtype=np.uint8)
        # Draw a very small white square (well under 10% area)
        cv2.rectangle(img, (390, 290), (410, 310), (255, 255, 255), -1)
        result = detect_receipt_boundary_opencv(img)
        assert result is None

    def test_detects_receipt_with_noisy_background(self):
        rng = np.random.default_rng(42)
        img = _make_receipt_on_table()
        noise = rng.integers(-20, 20, img.shape, dtype=np.int16)
        img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
        result = detect_receipt_boundary_opencv(img)
        assert result is not None
        assert result.shape == (4, 2)


class TestDetectReceiptBoundarySam:
    def test_returns_none_without_session(self):
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        assert detect_receipt_boundary_sam(img) is None

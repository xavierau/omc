"""Tests for receipt image sanitizer pipeline."""

import io
import math

import cv2
import numpy as np
import pytest
from PIL import Image

from app.services.sanitizer import (
    SanitizeResult,
    apply_exif_rotation,
    apply_perspective_correction,
    detect_receipt_boundary_opencv,
    detect_receipt_boundary_sam,
    enhance_contrast,
    remove_shadows,
    resize_for_detection,
    resize_to_standard,
    sanitize_receipt_image,
)
from app.utils.geometry import order_points


# --------------- fixtures ---------------

def _make_receipt_on_background(
    bg_size=(600, 800),
    receipt_color=255,
    bg_color=80,
    rotated=False,
) -> np.ndarray:
    """Create a synthetic receipt (white rect) on a gray background."""
    bg = np.full((*bg_size, 3), bg_color, dtype=np.uint8)
    h, w = bg_size
    margin = 80
    pts = np.array([
        [margin, margin],
        [w - margin, margin],
        [w - margin, h - margin],
        [margin, h - margin],
    ], dtype=np.int32)

    if rotated:
        cx, cy = w // 2, h // 2
        angle = 5
        cos_a, sin_a = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        new_pts = []
        for x, y in pts:
            nx = int(cos_a * (x - cx) - sin_a * (y - cy) + cx)
            ny = int(sin_a * (x - cx) + cos_a * (y - cy) + cy)
            new_pts.append([nx, ny])
        pts = np.array(new_pts, dtype=np.int32)

    cv2.fillPoly(bg, [pts], (receipt_color, receipt_color, receipt_color))
    # draw some "text lines" inside
    for i in range(5):
        y = margin + 40 + i * 30
        cv2.line(bg, (margin + 20, y), (w - margin - 20, y), (40, 40, 40), 2)
    return bg


def _image_to_bytes(img: np.ndarray, fmt: str = ".png") -> bytes:
    """Encode numpy image to bytes."""
    ok, buf = cv2.imencode(fmt, img)
    assert ok
    return buf.tobytes()


@pytest.fixture
def clean_receipt_image():
    return _make_receipt_on_background()


@pytest.fixture
def clean_receipt_bytes(clean_receipt_image):
    return _image_to_bytes(clean_receipt_image)


@pytest.fixture
def noisy_image():
    """Image with no clear rectangular boundary."""
    return np.random.randint(0, 255, (400, 300, 3), dtype=np.uint8)


@pytest.fixture
def noisy_bytes(noisy_image):
    return _image_to_bytes(noisy_image)


# --------------- order_points ---------------

class TestOrderPoints:
    def test_orders_rectangle_points(self):
        pts = np.array([[100, 0], [0, 0], [0, 100], [100, 100]], dtype=np.float32)
        ordered = order_points(pts)
        assert ordered.shape == (4, 2)
        # top-left has smallest sum
        assert ordered[0].tolist() == [0.0, 0.0]
        # bottom-right has largest sum
        assert ordered[2].tolist() == [100.0, 100.0]


# --------------- apply_exif_rotation ---------------

class TestApplyExifRotation:
    def test_returns_numpy_array(self, clean_receipt_bytes):
        result = apply_exif_rotation(clean_receipt_bytes)
        assert isinstance(result, np.ndarray)
        assert result.ndim == 3

    def test_preserves_dimensions(self, clean_receipt_bytes):
        result = apply_exif_rotation(clean_receipt_bytes)
        assert result.shape[0] > 0 and result.shape[1] > 0


# --------------- resize_for_detection ---------------

class TestResizeForDetection:
    def test_returns_resized_and_scale(self, clean_receipt_image):
        resized, scale = resize_for_detection(clean_receipt_image, max_width=500)
        assert resized.shape[1] <= 500
        assert isinstance(scale, float)
        assert scale > 0

    def test_small_image_unchanged(self):
        small = np.zeros((100, 200, 3), dtype=np.uint8)
        resized, scale = resize_for_detection(small, max_width=500)
        assert resized.shape[1] == 200
        assert scale == 1.0


# --------------- detect_receipt_boundary_opencv ---------------

class TestDetectReceiptBoundaryOpencv:
    def test_finds_four_corners_on_clean_image(self, clean_receipt_image):
        corners = detect_receipt_boundary_opencv(clean_receipt_image)
        assert corners is not None
        assert corners.shape == (4, 2)

    def test_returns_none_on_noisy_image(self, noisy_image):
        corners = detect_receipt_boundary_opencv(noisy_image)
        assert corners is None


# --------------- detect_receipt_boundary_sam ---------------

class TestDetectReceiptBoundarySam:
    def test_returns_none_without_session(self, clean_receipt_image):
        result = detect_receipt_boundary_sam(clean_receipt_image, sam_session=None)
        assert result is None


# --------------- apply_perspective_correction ---------------

class TestApplyPerspectiveCorrection:
    def test_output_is_rectangular(self, clean_receipt_image):
        corners = np.array([
            [80, 80], [520, 80], [520, 720], [80, 720]
        ], dtype=np.float32)
        result = apply_perspective_correction(clean_receipt_image, corners)
        assert isinstance(result, np.ndarray)
        assert result.ndim == 3
        assert result.shape[0] > 0 and result.shape[1] > 0


# --------------- remove_shadows ---------------

class TestRemoveShadows:
    def test_reduces_variance(self):
        img = np.zeros((200, 200, 3), dtype=np.uint8)
        img[:, :100] = 200  # bright left
        img[:, 100:] = 60   # dark right (shadow)
        result = remove_shadows(img)
        assert result.ndim >= 2
        original_std = np.std(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
        result_gray = result if result.ndim == 2 else cv2.cvtColor(result, cv2.COLOR_BGR2GRAY)
        assert np.std(result_gray) < original_std


# --------------- enhance_contrast ---------------

class TestEnhanceContrast:
    def test_returns_valid_image(self, clean_receipt_image):
        result = enhance_contrast(clean_receipt_image)
        assert isinstance(result, np.ndarray)
        assert result.shape[:2] == clean_receipt_image.shape[:2]


# --------------- resize_to_standard ---------------

class TestResizeToStandard:
    def test_resizes_to_target_width(self, clean_receipt_image):
        result = resize_to_standard(clean_receipt_image, target_width=1000)
        assert result.shape[1] == 1000

    def test_preserves_aspect_ratio(self, clean_receipt_image):
        h, w = clean_receipt_image.shape[:2]
        result = resize_to_standard(clean_receipt_image, target_width=1000)
        expected_h = int(h * (1000 / w))
        assert abs(result.shape[0] - expected_h) <= 1


# --------------- sanitize_receipt_image (full pipeline) ---------------

class TestSanitizeReceiptImage:
    def test_returns_sanitize_result(self, clean_receipt_bytes):
        result = sanitize_receipt_image(clean_receipt_bytes)
        assert isinstance(result, SanitizeResult)
        assert result.method in ("opencv", "efficient_sam", "original")
        assert isinstance(result.image, np.ndarray)
        assert len(result.original_size) == 2
        assert len(result.cleaned_size) == 2

    def test_clean_receipt_uses_opencv(self, clean_receipt_bytes):
        result = sanitize_receipt_image(clean_receipt_bytes)
        assert result.method == "opencv"
        assert result.corners_detected is True

    def test_noisy_image_falls_to_original(self, noisy_bytes):
        result = sanitize_receipt_image(noisy_bytes)
        assert result.method == "original"
        assert result.corners_detected is False

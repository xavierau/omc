"""EfficientSAM receipt segmentation using ONNX runtime."""

import logging
from typing import Optional

import cv2
import numpy as np

from app.utils.geometry import order_points

logger = logging.getLogger(__name__)

_MASK_MIN_RATIO = 0.05
_MASK_MAX_RATIO = 0.95
_MORPH_KERNEL_SIZE = 15
_INFERENCE_SIZE = 512


class SAMSegmenter:
    """Wraps EfficientSAM ONNX model for receipt segmentation."""

    def __init__(self, model_path: str = "models/efficient-sam.onnx"):
        self._session = None
        try:
            import onnxruntime as ort
            self._session = ort.InferenceSession(
                model_path,
                providers=["CPUExecutionProvider"],
            )
            logger.info("EfficientSAM loaded")
        except Exception as exc:
            logger.warning("EfficientSAM not available: %s", exc)

    def is_loaded(self) -> bool:
        return self._session is not None

    def segment(
        self, image: np.ndarray,
        point_coords: Optional[np.ndarray] = None,
    ) -> Optional[np.ndarray]:
        """Segment receipt, return binary mask (H,W) or None."""
        if not self.is_loaded():
            return None
        h, w = image.shape[:2]
        # Resize for inference (SAM is resolution-agnostic via prompts)
        small, scale = _resize_for_inference(image)
        sh, sw = small.shape[:2]
        img_input = _prepare_image(small)
        pts, labels = _build_prompts(sw, sh, point_coords)
        try:
            mask = self._infer(img_input, pts, labels, sh, sw)
            if mask is None:
                return None
            # Scale mask back to original size
            if scale != 1.0:
                mask = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)
            return mask
        except Exception as exc:
            logger.error("SAM inference failed: %s", exc)
            return None

    def _infer(self, img, pts, labels, h, w):
        outputs = self._session.run(
            output_names=None,
            input_feed={
                "batched_images": img,
                "batched_point_coords": pts[None, None],
                "batched_point_labels": labels[None, None],
            },
        )
        logits, iou = outputs[0], outputs[1]
        best = iou[0, 0].argmax()
        mask = (logits[0, 0, best] >= 0).astype(np.uint8) * 255
        mask = _clean_mask(mask)
        return _validate_mask(mask, h, w)

    def segment_to_corners(self, image: np.ndarray):
        """Segment and return (4,2) corners or None."""
        mask = self.segment(image)
        if mask is None:
            return None
        return _mask_to_corners(mask)


def _resize_for_inference(image: np.ndarray):
    """Resize to _INFERENCE_SIZE on longest side. Returns (resized, scale)."""
    h, w = image.shape[:2]
    if max(h, w) <= _INFERENCE_SIZE:
        return image, 1.0
    scale = _INFERENCE_SIZE / max(h, w)
    new_w, new_h = int(w * scale), int(h * scale)
    return cv2.resize(image, (new_w, new_h)), scale


def _prepare_image(image: np.ndarray) -> np.ndarray:
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    return rgb.transpose(2, 0, 1)[None].astype(np.float32) / 255.0


def _build_prompts(w, h, point_coords):
    if point_coords is not None:
        c = point_coords.astype(np.float32)
        return c, np.ones(len(c), dtype=np.float32)
    # Single center foreground point works best — background
    # points confuse the model on receipt-on-table images.
    pts = np.array([[w // 2, h // 2]], dtype=np.float32)
    labels = np.array([1], dtype=np.float32)
    return pts, labels


def _clean_mask(mask: np.ndarray) -> np.ndarray:
    k = cv2.getStructuringElement(
        cv2.MORPH_RECT, (_MORPH_KERNEL_SIZE, _MORPH_KERNEL_SIZE),
    )
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k)
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, k)


def _validate_mask(mask, h, w):
    ratio = mask.sum() / (255 * h * w)
    if ratio < _MASK_MIN_RATIO or ratio > _MASK_MAX_RATIO:
        logger.warning("SAM mask ratio %.2f outside range", ratio)
        return None
    return mask


def _mask_to_corners(mask: np.ndarray):
    contours, _ = cv2.findContours(
        mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE,
    )
    if not contours:
        return None
    cnt = max(contours, key=cv2.contourArea)
    peri = cv2.arcLength(cnt, True)
    for eps in [0.02, 0.03, 0.04, 0.05]:
        approx = cv2.approxPolyDP(cnt, eps * peri, True)
        if len(approx) == 4:
            return order_points(approx.reshape(4, 2))
    box = cv2.boxPoints(cv2.minAreaRect(cnt)).astype(np.float32)
    return order_points(box)

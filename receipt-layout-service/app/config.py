"""Application configuration from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    model_path: str = "models/doclayout_yolo_docstructbench.pt"
    sam_model_path: str = "models/efficient-sam.onnx"
    default_threshold: float = 0.65
    api_key: str = ""
    max_image_size_mb: int = 10
    log_level: str = "INFO"

    class Config:
        env_prefix = "LAYOUT_"


def get_settings() -> Settings:
    """Factory for Settings (allows override in tests)."""
    return Settings()

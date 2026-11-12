"""Tests for route endpoints: health, preprocess, templates, verify."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from tests.conftest import (
    jpeg_bytes,
    make_app,
    mock_sanitize_result,
    sample_template_dict,
    sample_verification,
)


@pytest.mark.anyio
async def test_health_returns_ok():
    app = make_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        resp = await ac.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "model_loaded" in data
    assert data["version"] == "1.0.0"


@pytest.mark.anyio
async def test_preprocess_invalid_url():
    app = make_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        resp = await ac.post("/preprocess", json={"image_url": ""})
    assert resp.status_code in (400, 422)


@pytest.mark.anyio
async def test_templates_build_too_few_urls():
    app = make_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        resp = await ac.post(
            "/templates/build",
            json={"image_urls": ["http://a.com/1.jpg"], "restaurant_id": "r1"},
        )
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_verify_returns_score():
    app = make_app()
    mock_dl = AsyncMock(return_value=jpeg_bytes())
    with (
        patch("app.routes.verify.download_image", mock_dl),
        patch("app.routes.verify.sanitize_receipt_image") as m_san,
        patch("app.routes.verify.compare_layout") as m_cmp,
    ):
        m_san.return_value = mock_sanitize_result()
        m_cmp.return_value = sample_verification()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://t") as ac:
            resp = await ac.post("/verify", json={
                "image_url": "http://example.com/img.jpg",
                "template": sample_template_dict(),
                "threshold": 0.65,
            })
    assert resp.status_code == 200
    assert "score" in resp.json()
    assert "passed" in resp.json()

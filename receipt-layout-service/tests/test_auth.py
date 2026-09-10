"""Tests for API key authentication middleware."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from tests.conftest import jpeg_bytes, make_app, mock_sanitize_result


@pytest.mark.anyio
async def test_auth_rejects_without_key():
    app = make_app(api_key="secret123")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        resp = await ac.post("/preprocess", json={"image_url": "http://x.com/i.jpg"})
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_auth_allows_with_valid_key():
    app = make_app(api_key="secret123")
    mock_dl = AsyncMock(return_value=jpeg_bytes())
    with (
        patch("app.routes.preprocess.download_image", mock_dl),
        patch("app.routes.preprocess.sanitize_receipt_image") as m_san,
    ):
        m_san.return_value = mock_sanitize_result()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://t") as ac:
            resp = await ac.post(
                "/preprocess",
                json={"image_url": "http://example.com/img.jpg"},
                headers={"Authorization": "Bearer secret123"},
            )
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_health_bypasses_auth():
    app = make_app(api_key="secret123")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as ac:
        resp = await ac.get("/health")
    assert resp.status_code == 200

"""
Mudbrick v2 -- Tests for Page Operations Router
"""

from __future__ import annotations

from pathlib import Path

import fitz
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.dependencies import get_session_manager
from app.services.session_manager import SessionManager
from app.services.adapters.local_storage import LocalBlobAdapter
from app.services.adapters.local_kv import LocalKVAdapter


@pytest.fixture
def test_session_mgr(tmp_data_dir: Path) -> SessionManager:
    blob = LocalBlobAdapter(str(tmp_data_dir))
    kv = LocalKVAdapter(str(tmp_data_dir))
    return SessionManager(blob=blob, kv=kv)


@pytest.fixture
async def page_client(test_session_mgr: SessionManager):
    app.dependency_overrides[get_session_manager] = lambda: test_session_mgr
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def multi_page_pdf() -> bytes:
    doc = fitz.open()
    for i in range(5):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 72), f"Page {i + 1}", fontsize=16)
    data = doc.tobytes()
    doc.close()
    return data


async def create_session(
    client: AsyncClient, pdf_bytes: bytes
) -> str:
    resp = await client.post(
        "/api/documents/upload",
        files={"file": ("test.pdf", pdf_bytes, "application/pdf")},
    )
    return resp.json()["session_id"]


@pytest.mark.asyncio
class TestPageOperations:
    async def test_rotate(self, page_client: AsyncClient, multi_page_pdf: bytes):
        sid = await create_session(page_client, multi_page_pdf)
        resp = await page_client.post(
            f"/api/pages/{sid}/rotate",
            json={"pages": [1, 3], "degrees": 90},
        )
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        assert resp.json()["page_count"] == 5

    async def test_delete(self, page_client: AsyncClient, multi_page_pdf: bytes):
        sid = await create_session(page_client, multi_page_pdf)
        resp = await page_client.post(
            f"/api/pages/{sid}/delete",
            json={"pages": [2, 4]},
        )
        assert resp.status_code == 200
        assert resp.json()["page_count"] == 3

    async def test_delete_all_fails(
        self, page_client: AsyncClient, multi_page_pdf: bytes
    ):
        sid = await create_session(page_client, multi_page_pdf)
        resp = await page_client.post(
            f"/api/pages/{sid}/delete",
            json={"pages": [1, 2, 3, 4, 5]},
        )
        assert resp.status_code == 400

    async def test_reorder(self, page_client: AsyncClient, multi_page_pdf: bytes):
        sid = await create_session(page_client, multi_page_pdf)
        resp = await page_client.post(
            f"/api/pages/{sid}/reorder",
            json={"order": [5, 4, 3, 2, 1]},
        )
        assert resp.status_code == 200
        assert resp.json()["page_count"] == 5

    async def test_insert_blank(
        self, page_client: AsyncClient, multi_page_pdf: bytes
    ):
        sid = await create_session(page_client, multi_page_pdf)
        resp = await page_client.post(
            f"/api/pages/{sid}/insert",
            json={"after": 2, "size": "letter"},
        )
        assert resp.status_code == 200
        assert resp.json()["page_count"] == 6

    async def test_crop(self, page_client: AsyncClient, multi_page_pdf: bytes):
        sid = await create_session(page_client, multi_page_pdf)
        resp = await page_client.post(
            f"/api/pages/{sid}/crop",
            json={"pages": [1], "box": {"x": 50, "y": 50, "w": 400, "h": 600}},
        )
        assert resp.status_code == 200

    async def test_thumbnail(
        self, page_client: AsyncClient, multi_page_pdf: bytes
    ):
        sid = await create_session(page_client, multi_page_pdf)
        resp = await page_client.get(
            f"/api/pages/{sid}/1/thumbnail?width=200"
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        # PNG magic bytes
        assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"

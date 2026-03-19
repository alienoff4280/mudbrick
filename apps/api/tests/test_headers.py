"""
Mudbrick v2 -- Headers/Footers Router Tests
"""

from __future__ import annotations

from pathlib import Path

import fitz
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.dependencies import get_session_manager
from app.services.session_manager import SessionManager


@pytest.fixture
def hf_session_mgr(tmp_path: Path) -> SessionManager:
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    return SessionManager(sessions_dir=sessions_dir)


@pytest.fixture
async def hf_client(hf_session_mgr: SessionManager):
    app.dependency_overrides[get_session_manager] = lambda: hf_session_mgr
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def three_page_pdf(tmp_path: Path) -> Path:
    doc = fitz.open()
    for i in range(3):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 100), f"Page {i + 1}", fontsize=16)
    path = tmp_path / "headers_test.pdf"
    doc.save(str(path))
    doc.close()
    return path


async def _open(client: AsyncClient, path: Path) -> str:
    resp = await client.post("/api/documents/open", json={"file_path": str(path)})
    assert resp.status_code == 200
    return resp.json()["session_id"]


def _get_page_texts(sm: SessionManager, sid: str) -> list[str]:
    pdf_bytes = sm.get_current_pdf_bytes(sid)
    assert pdf_bytes is not None
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        return [doc[i].get_text("text") for i in range(doc.page_count)]
    finally:
        doc.close()


@pytest.mark.asyncio
async def test_apply_header_static_text(hf_client: AsyncClient, hf_session_mgr: SessionManager, three_page_pdf: Path):
    sid = await _open(hf_client, three_page_pdf)
    resp = await hf_client.post(f"/api/headers/{sid}", json={
        "top_center": "CONFIDENTIAL",
    })
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    texts = _get_page_texts(hf_session_mgr, sid)
    for t in texts:
        assert "CONFIDENTIAL" in t


@pytest.mark.asyncio
async def test_apply_footer_page_numbers(hf_client: AsyncClient, hf_session_mgr: SessionManager, three_page_pdf: Path):
    sid = await _open(hf_client, three_page_pdf)
    resp = await hf_client.post(f"/api/headers/{sid}", json={
        "bottom_right": "{page}/{pages}",
    })
    assert resp.status_code == 200

    texts = _get_page_texts(hf_session_mgr, sid)
    assert "1/3" in texts[0]
    assert "2/3" in texts[1]
    assert "3/3" in texts[2]


@pytest.mark.asyncio
async def test_apply_header_skip_first(hf_client: AsyncClient, hf_session_mgr: SessionManager, three_page_pdf: Path):
    sid = await _open(hf_client, three_page_pdf)
    resp = await hf_client.post(f"/api/headers/{sid}", json={
        "top_left": "DRAFT",
        "skip_first": True,
    })
    assert resp.status_code == 200

    texts = _get_page_texts(hf_session_mgr, sid)
    assert "DRAFT" not in texts[0]
    assert "DRAFT" in texts[1]
    assert "DRAFT" in texts[2]


@pytest.mark.asyncio
async def test_apply_header_with_filename(hf_client: AsyncClient, hf_session_mgr: SessionManager, three_page_pdf: Path):
    sid = await _open(hf_client, three_page_pdf)
    resp = await hf_client.post(f"/api/headers/{sid}", json={
        "top_right": "{filename}",
        "filename": "report.pdf",
    })
    assert resp.status_code == 200

    texts = _get_page_texts(hf_session_mgr, sid)
    assert "report.pdf" in texts[0]


@pytest.mark.asyncio
async def test_apply_header_invalid_session(hf_client: AsyncClient):
    resp = await hf_client.post("/api/headers/nonexistent", json={
        "top_center": "Test",
    })
    assert resp.status_code == 404

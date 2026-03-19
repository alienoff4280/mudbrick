"""
Mudbrick v2 -- Exhibits Router Tests
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
def exhibit_session_mgr(tmp_path: Path) -> SessionManager:
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    return SessionManager(sessions_dir=sessions_dir)


@pytest.fixture
async def exhibit_client(exhibit_session_mgr: SessionManager):
    app.dependency_overrides[get_session_manager] = lambda: exhibit_session_mgr
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def three_page_pdf(tmp_path: Path) -> Path:
    doc = fitz.open()
    for i in range(3):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 100), f"Document page {i + 1}", fontsize=16)
    path = tmp_path / "exhibit_test.pdf"
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
async def test_stamp_exhibits_default(exhibit_client: AsyncClient, exhibit_session_mgr: SessionManager, three_page_pdf: Path):
    sid = await _open(exhibit_client, three_page_pdf)
    resp = await exhibit_client.post(f"/api/exhibits/{sid}/stamp", json={
        "format": "Exhibit {num}",
        "start_num": 1,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True

    texts = _get_page_texts(exhibit_session_mgr, sid)
    assert "Exhibit 1" in texts[0]
    assert "Exhibit 2" in texts[1]
    assert "Exhibit 3" in texts[2]


@pytest.mark.asyncio
async def test_stamp_exhibits_custom_format(exhibit_client: AsyncClient, exhibit_session_mgr: SessionManager, three_page_pdf: Path):
    sid = await _open(exhibit_client, three_page_pdf)
    resp = await exhibit_client.post(f"/api/exhibits/{sid}/stamp", json={
        "format": "EX-{num}",
        "start_num": 10,
    })
    assert resp.status_code == 200

    texts = _get_page_texts(exhibit_session_mgr, sid)
    assert "EX-10" in texts[0]
    assert "EX-11" in texts[1]


@pytest.mark.asyncio
async def test_stamp_exhibits_specific_pages(exhibit_client: AsyncClient, exhibit_session_mgr: SessionManager, three_page_pdf: Path):
    sid = await _open(exhibit_client, three_page_pdf)
    resp = await exhibit_client.post(f"/api/exhibits/{sid}/stamp", json={
        "format": "Exhibit {num}",
        "start_num": 1,
        "pages": [1, 3],
    })
    assert resp.status_code == 200

    texts = _get_page_texts(exhibit_session_mgr, sid)
    assert "Exhibit 1" in texts[0]
    assert "Exhibit" not in texts[1]  # Page 2 should not be stamped
    assert "Exhibit 2" in texts[2]


@pytest.mark.asyncio
async def test_stamp_exhibits_invalid_session(exhibit_client: AsyncClient):
    resp = await exhibit_client.post("/api/exhibits/nonexistent/stamp", json={
        "format": "Exhibit {num}",
    })
    assert resp.status_code == 404

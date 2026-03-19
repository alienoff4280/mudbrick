"""
Mudbrick v2 -- Bates Numbering Router Tests
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
def bates_session_mgr(tmp_path: Path) -> SessionManager:
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    return SessionManager(sessions_dir=sessions_dir)


@pytest.fixture
async def bates_client(bates_session_mgr: SessionManager):
    app.dependency_overrides[get_session_manager] = lambda: bates_session_mgr
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
    path = tmp_path / "bates_test.pdf"
    doc.save(str(path))
    doc.close()
    return path


async def _open(client: AsyncClient, path: Path) -> str:
    resp = await client.post("/api/documents/open", json={"file_path": str(path)})
    assert resp.status_code == 200
    return resp.json()["session_id"]


@pytest.mark.asyncio
async def test_apply_bates_default(bates_client: AsyncClient, three_page_pdf: Path):
    sid = await _open(bates_client, three_page_pdf)
    resp = await bates_client.post(f"/api/bates/{sid}", json={
        "prefix": "DOC-",
        "start_num": 1,
        "zero_pad": 4,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["first_label"] == "DOC-0001"
    assert data["last_label"] == "DOC-0003"


@pytest.mark.asyncio
async def test_apply_bates_custom_start(bates_client: AsyncClient, three_page_pdf: Path):
    sid = await _open(bates_client, three_page_pdf)
    resp = await bates_client.post(f"/api/bates/{sid}", json={
        "prefix": "",
        "start_num": 100,
        "zero_pad": 6,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["first_label"] == "000100"
    assert data["last_label"] == "000102"


@pytest.mark.asyncio
async def test_apply_bates_with_suffix(bates_client: AsyncClient, three_page_pdf: Path):
    sid = await _open(bates_client, three_page_pdf)
    resp = await bates_client.post(f"/api/bates/{sid}", json={
        "prefix": "EX-",
        "suffix": "-A",
        "start_num": 1,
        "zero_pad": 3,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["first_label"] == "EX-001-A"


@pytest.mark.asyncio
async def test_apply_bates_page_range(bates_client: AsyncClient, three_page_pdf: Path):
    sid = await _open(bates_client, three_page_pdf)
    resp = await bates_client.post(f"/api/bates/{sid}", json={
        "prefix": "P-",
        "start_num": 1,
        "zero_pad": 3,
        "start_page": 2,
        "end_page": 2,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["first_label"] == "P-001"
    assert data["last_label"] == "P-001"
    assert data["page_count"] == 1


@pytest.mark.asyncio
async def test_apply_bates_invalid_session(bates_client: AsyncClient):
    resp = await bates_client.post("/api/bates/nonexistent", json={
        "prefix": "X-",
        "start_num": 1,
    })
    assert resp.status_code == 404

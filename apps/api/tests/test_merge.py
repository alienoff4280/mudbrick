"""
Mudbrick v2 -- Merge Router Tests
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
def merge_session_mgr(tmp_path: Path) -> SessionManager:
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    return SessionManager(sessions_dir=sessions_dir)


@pytest.fixture
async def merge_client(merge_session_mgr: SessionManager):
    app.dependency_overrides[get_session_manager] = lambda: merge_session_mgr
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


def _create_pdf(tmp_path: Path, name: str, pages: int) -> Path:
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 72), f"{name} Page {i + 1}", fontsize=16)
    path = tmp_path / name
    doc.save(str(path))
    doc.close()
    return path


@pytest.mark.asyncio
async def test_merge_two_files(merge_client: AsyncClient, tmp_path: Path):
    pdf1 = _create_pdf(tmp_path, "doc1.pdf", 2)
    pdf2 = _create_pdf(tmp_path, "doc2.pdf", 3)

    resp = await merge_client.post("/api/merge", json={
        "file_paths": [str(pdf1), str(pdf2)],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["page_count"] == 5
    assert "session_id" in data


@pytest.mark.asyncio
async def test_merge_five_files(merge_client: AsyncClient, tmp_path: Path):
    paths = [_create_pdf(tmp_path, f"doc{i}.pdf", 1) for i in range(5)]

    resp = await merge_client.post("/api/merge", json={
        "file_paths": [str(p) for p in paths],
    })
    assert resp.status_code == 200
    assert resp.json()["page_count"] == 5


@pytest.mark.asyncio
async def test_merge_requires_two_files(merge_client: AsyncClient, tmp_path: Path):
    pdf = _create_pdf(tmp_path, "single.pdf", 1)

    resp = await merge_client.post("/api/merge", json={
        "file_paths": [str(pdf)],
    })
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_merge_invalid_path(merge_client: AsyncClient, tmp_path: Path):
    pdf = _create_pdf(tmp_path, "real.pdf", 1)

    resp = await merge_client.post("/api/merge", json={
        "file_paths": [str(pdf), "/nonexistent/fake.pdf"],
    })
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_merge_creates_valid_session(merge_client: AsyncClient, merge_session_mgr: SessionManager, tmp_path: Path):
    pdf1 = _create_pdf(tmp_path, "a.pdf", 2)
    pdf2 = _create_pdf(tmp_path, "b.pdf", 2)

    resp = await merge_client.post("/api/merge", json={
        "file_paths": [str(pdf1), str(pdf2)],
    })
    data = resp.json()
    sid = data["session_id"]

    # Verify the merged document is accessible
    info_resp = await merge_client.get(f"/api/documents/{sid}")
    assert info_resp.status_code == 200
    assert info_resp.json()["page_count"] == 4

"""
Mudbrick v2 -- Forms Router Tests

Tests for form field detection, fill, flatten, and export/import.
"""

from __future__ import annotations

import json
from pathlib import Path

import fitz
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.dependencies import get_session_manager
from app.services.session_manager import SessionManager


@pytest.fixture
def forms_session_mgr(tmp_path: Path) -> SessionManager:
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()
    return SessionManager(sessions_dir=sessions_dir)


@pytest.fixture
async def forms_client(forms_session_mgr: SessionManager):
    app.dependency_overrides[get_session_manager] = lambda: forms_session_mgr
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def pdf_with_forms(tmp_path: Path) -> Path:
    """Create a PDF with text form fields."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 50), "Form Test Document", fontsize=16)

    # Text field
    w1 = fitz.Widget()
    w1.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    w1.field_name = "full_name"
    w1.field_value = ""
    w1.rect = fitz.Rect(72, 80, 300, 100)
    page.add_widget(w1)

    # Another text field
    w2 = fitz.Widget()
    w2.field_type = fitz.PDF_WIDGET_TYPE_TEXT
    w2.field_name = "email"
    w2.field_value = ""
    w2.rect = fitz.Rect(72, 120, 300, 140)
    page.add_widget(w2)

    path = tmp_path / "form_test.pdf"
    doc.save(str(path))
    doc.close()
    return path


@pytest.fixture
def pdf_without_forms(tmp_path: Path) -> Path:
    """Create a plain PDF without form fields."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "No forms here", fontsize=16)
    path = tmp_path / "no_forms.pdf"
    doc.save(str(path))
    doc.close()
    return path


async def _open(client: AsyncClient, path: Path) -> str:
    resp = await client.post("/api/documents/open", json={"file_path": str(path)})
    assert resp.status_code == 200
    return resp.json()["session_id"]


@pytest.mark.asyncio
async def test_detect_form_fields(forms_client: AsyncClient, pdf_with_forms: Path):
    sid = await _open(forms_client, pdf_with_forms)
    resp = await forms_client.get(f"/api/forms/{sid}/fields")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 2
    names = [f["name"] for f in data["fields"]]
    assert "full_name" in names
    assert "email" in names


@pytest.mark.asyncio
async def test_detect_no_form_fields(forms_client: AsyncClient, pdf_without_forms: Path):
    sid = await _open(forms_client, pdf_without_forms)
    resp = await forms_client.get(f"/api/forms/{sid}/fields")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["fields"] == []


@pytest.mark.asyncio
async def test_fill_form_fields(forms_client: AsyncClient, pdf_with_forms: Path):
    sid = await _open(forms_client, pdf_with_forms)
    resp = await forms_client.post(f"/api/forms/{sid}/fill", json={
        "fields": {
            "full_name": "John Doe",
            "email": "john@example.com",
        }
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["updated"] >= 2


@pytest.mark.asyncio
async def test_flatten_form(forms_client: AsyncClient, pdf_with_forms: Path):
    sid = await _open(forms_client, pdf_with_forms)

    # Fill first
    await forms_client.post(f"/api/forms/{sid}/fill", json={
        "fields": {"full_name": "Test User"}
    })

    # Then flatten
    resp = await forms_client.post(f"/api/forms/{sid}/flatten")
    assert resp.status_code == 200
    assert resp.json()["success"] is True


@pytest.mark.asyncio
async def test_export_form_data(forms_client: AsyncClient, pdf_with_forms: Path):
    sid = await _open(forms_client, pdf_with_forms)

    # Fill first
    await forms_client.post(f"/api/forms/{sid}/fill", json={
        "fields": {"full_name": "Export Test", "email": "test@test.com"}
    })

    resp = await forms_client.get(f"/api/forms/{sid}/export")
    assert resp.status_code == 200
    data = resp.json()
    assert "full_name" in data
    assert data["full_name"] == "Export Test"


@pytest.mark.asyncio
async def test_import_form_data(forms_client: AsyncClient, pdf_with_forms: Path):
    sid = await _open(forms_client, pdf_with_forms)
    resp = await forms_client.post(f"/api/forms/{sid}/import", json={
        "data": {
            "full_name": "Imported Name",
            "email": "imported@example.com",
        }
    })
    assert resp.status_code == 200
    assert resp.json()["success"] is True


@pytest.mark.asyncio
async def test_forms_invalid_session(forms_client: AsyncClient):
    resp = await forms_client.get("/api/forms/nonexistent/fields")
    assert resp.status_code == 404

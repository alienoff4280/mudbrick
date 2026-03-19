"""
Mudbrick v2 -- Tests for Document Upload/Download Router
"""

from __future__ import annotations

import io
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
async def doc_client(test_session_mgr: SessionManager):
    """Create test client with overridden session manager."""
    app.dependency_overrides[get_session_manager] = lambda: test_session_mgr
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def valid_pdf_bytes() -> bytes:
    """Create a valid PDF using PyMuPDF."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "Test document", fontsize=12)
    data = doc.tobytes()
    doc.close()
    return data


@pytest.mark.asyncio
class TestDocumentUpload:
    async def test_upload_pdf(self, doc_client: AsyncClient, valid_pdf_bytes: bytes):
        response = await doc_client.post(
            "/api/documents/upload",
            files={"file": ("test.pdf", valid_pdf_bytes, "application/pdf")},
        )
        assert response.status_code == 200
        data = response.json()
        assert "session_id" in data
        assert data["page_count"] == 1
        assert data["file_size"] > 0

    async def test_upload_non_pdf(self, doc_client: AsyncClient):
        response = await doc_client.post(
            "/api/documents/upload",
            files={"file": ("test.txt", b"hello", "text/plain")},
        )
        assert response.status_code == 400

    async def test_upload_invalid_pdf(self, doc_client: AsyncClient):
        response = await doc_client.post(
            "/api/documents/upload",
            files={"file": ("test.pdf", b"not a pdf", "application/pdf")},
        )
        assert response.status_code == 400


@pytest.mark.asyncio
class TestDocumentOperations:
    async def test_get_document_info(
        self, doc_client: AsyncClient, valid_pdf_bytes: bytes
    ):
        # Upload first
        upload = await doc_client.post(
            "/api/documents/upload",
            files={"file": ("test.pdf", valid_pdf_bytes, "application/pdf")},
        )
        sid = upload.json()["session_id"]

        # Get info
        response = await doc_client.get(f"/api/documents/{sid}")
        assert response.status_code == 200
        data = response.json()
        assert data["session_id"] == sid
        assert data["page_count"] == 1
        assert len(data["versions"]) == 1

    async def test_get_nonexistent_document(self, doc_client: AsyncClient):
        response = await doc_client.get("/api/documents/nonexistent")
        assert response.status_code == 404

    async def test_download_document(
        self, doc_client: AsyncClient, valid_pdf_bytes: bytes
    ):
        upload = await doc_client.post(
            "/api/documents/upload",
            files={"file": ("test.pdf", valid_pdf_bytes, "application/pdf")},
        )
        sid = upload.json()["session_id"]

        response = await doc_client.get(f"/api/documents/{sid}/download")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert response.content[:5] == b"%PDF-"

    async def test_delete_document(
        self, doc_client: AsyncClient, valid_pdf_bytes: bytes
    ):
        upload = await doc_client.post(
            "/api/documents/upload",
            files={"file": ("test.pdf", valid_pdf_bytes, "application/pdf")},
        )
        sid = upload.json()["session_id"]

        response = await doc_client.delete(f"/api/documents/{sid}")
        assert response.status_code == 200
        assert response.json()["deleted"] is True

        # Should be gone
        response = await doc_client.get(f"/api/documents/{sid}")
        assert response.status_code == 404

    async def test_undo_redo(
        self,
        doc_client: AsyncClient,
        valid_pdf_bytes: bytes,
        test_session_mgr: SessionManager,
    ):
        upload = await doc_client.post(
            "/api/documents/upload",
            files={"file": ("test.pdf", valid_pdf_bytes, "application/pdf")},
        )
        sid = upload.json()["session_id"]

        # Make a modification via session manager directly
        modified = valid_pdf_bytes + b"\n% modified"
        # We need a valid PDF for this, create one
        doc = fitz.open()
        doc.new_page(width=612, height=792)
        doc[0].insert_text((72, 72), "Modified", fontsize=12)
        mod_bytes = doc.tobytes()
        doc.close()

        await test_session_mgr.save_pdf(sid, mod_bytes, "rotate")

        # Undo
        response = await doc_client.post(f"/api/documents/{sid}/undo")
        assert response.status_code == 200
        assert response.json()["version"] == 1

        # Redo
        response = await doc_client.post(f"/api/documents/{sid}/redo")
        assert response.status_code == 200
        assert response.json()["version"] == 2

    async def test_undo_nothing(
        self, doc_client: AsyncClient, valid_pdf_bytes: bytes
    ):
        upload = await doc_client.post(
            "/api/documents/upload",
            files={"file": ("test.pdf", valid_pdf_bytes, "application/pdf")},
        )
        sid = upload.json()["session_id"]

        response = await doc_client.post(f"/api/documents/{sid}/undo")
        assert response.status_code == 400

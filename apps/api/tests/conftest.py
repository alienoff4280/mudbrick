"""
Mudbrick v2 -- Test Configuration and Fixtures
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

# Force local environment for tests
os.environ["MUDBRICK_ENVIRONMENT"] = "local"


@pytest.fixture
def tmp_data_dir(tmp_path: Path) -> Path:
    """Provide a temporary directory for test data storage."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    return data_dir


@pytest.fixture
def blob_adapter(tmp_data_dir: Path):
    """Create a LocalBlobAdapter pointing to a temporary directory."""
    from app.services.adapters.local_storage import LocalBlobAdapter

    return LocalBlobAdapter(str(tmp_data_dir))


@pytest.fixture
def kv_adapter(tmp_data_dir: Path):
    """Create a LocalKVAdapter pointing to a temporary directory."""
    from app.services.adapters.local_kv import LocalKVAdapter

    return LocalKVAdapter(str(tmp_data_dir))


@pytest.fixture
async def client():
    """Create a test HTTP client for the FastAPI app."""
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
def sample_pdf_bytes() -> bytes:
    """Return a minimal valid PDF for testing."""
    # Minimal valid PDF (1 page, blank)
    return (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R "
        b"/MediaBox [0 0 612 792] >>\nendobj\n"
        b"xref\n0 4\n"
        b"0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"0000000115 00000 n \n"
        b"trailer\n<< /Size 4 /Root 1 0 R >>\n"
        b"startxref\n196\n%%EOF\n"
    )

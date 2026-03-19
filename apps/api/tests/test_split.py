"""
Mudbrick v2 -- Split PDF Tests
"""

from __future__ import annotations

from pathlib import Path

import fitz
import pytest

from app.routers.split import _parse_range


# ── Parse Range Tests ──


class TestParseRange:
    def test_single_page(self):
        assert _parse_range("3", 10) == [3]

    def test_page_range(self):
        assert _parse_range("1-3", 10) == [1, 2, 3]

    def test_out_of_range(self):
        assert _parse_range("1-20", 5) == [1, 2, 3, 4, 5]

    def test_invalid_range(self):
        assert _parse_range("abc", 10) == []

    def test_single_out_of_range(self):
        assert _parse_range("15", 10) == []

    def test_whitespace(self):
        assert _parse_range(" 2 - 4 ", 10) == [2, 3, 4]


# ── API Router Tests ──


def _create_multi_page_pdf(tmp_path: Path, pages: int = 5) -> Path:
    """Create a multi-page PDF for testing."""
    doc = fitz.open()
    for i in range(pages):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 72), f"Page {i + 1}", fontsize=24)
    pdf_path = tmp_path / "multipage.pdf"
    doc.save(str(pdf_path))
    doc.close()
    return pdf_path


@pytest.mark.asyncio
async def test_split_invalid_session(client):
    resp = await client.post(
        "/api/split/nonexistent",
        json={"ranges": ["1-3"], "output_dir": "/tmp/split_test"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_split_pdf_basic(client, tmp_path):
    # Create a multi-page PDF
    pdf_path = _create_multi_page_pdf(tmp_path, pages=6)

    # Open it
    resp = await client.post(
        "/api/documents/open",
        json={"file_path": str(pdf_path)},
    )
    assert resp.status_code == 200
    sid = resp.json()["session_id"]

    # Split it
    output_dir = tmp_path / "split_output"
    resp = await client.post(
        f"/api/split/{sid}",
        json={
            "ranges": ["1-3", "4-6"],
            "output_dir": str(output_dir),
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["total_parts"] == 2

    # Verify files were created
    for part in data["parts"]:
        assert Path(part["file_path"]).exists()
        assert part["page_count"] > 0
        assert part["file_size"] > 0


@pytest.mark.asyncio
async def test_split_pdf_single_page_ranges(client, tmp_path):
    pdf_path = _create_multi_page_pdf(tmp_path, pages=3)

    resp = await client.post(
        "/api/documents/open",
        json={"file_path": str(pdf_path)},
    )
    assert resp.status_code == 200
    sid = resp.json()["session_id"]

    output_dir = tmp_path / "split_singles"
    resp = await client.post(
        f"/api/split/{sid}",
        json={
            "ranges": ["1", "2", "3"],
            "output_dir": str(output_dir),
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_parts"] == 3
    for part in data["parts"]:
        assert part["page_count"] == 1


@pytest.mark.asyncio
async def test_split_pdf_custom_prefix(client, tmp_path):
    pdf_path = _create_multi_page_pdf(tmp_path, pages=4)

    resp = await client.post(
        "/api/documents/open",
        json={"file_path": str(pdf_path)},
    )
    assert resp.status_code == 200
    sid = resp.json()["session_id"]

    output_dir = tmp_path / "split_prefix"
    resp = await client.post(
        f"/api/split/{sid}",
        json={
            "ranges": ["1-2", "3-4"],
            "output_dir": str(output_dir),
            "filename_prefix": "contract",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    for part in data["parts"]:
        assert "contract_part" in part["file_path"]


@pytest.mark.asyncio
async def test_split_pdf_invalid_ranges(client, tmp_path):
    pdf_path = _create_multi_page_pdf(tmp_path, pages=3)

    resp = await client.post(
        "/api/documents/open",
        json={"file_path": str(pdf_path)},
    )
    assert resp.status_code == 200
    sid = resp.json()["session_id"]

    output_dir = tmp_path / "split_bad"
    resp = await client.post(
        f"/api/split/{sid}",
        json={
            "ranges": ["abc", "xyz"],
            "output_dir": str(output_dir),
        },
    )
    assert resp.status_code == 400

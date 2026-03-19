"""
Mudbrick v2 -- Text Extraction, Search, and Edit Tests
"""

from __future__ import annotations

import fitz
import pytest

from app.routers.text import _extract_page_text, _hex_to_rgb_tuple, _parse_page_range


# ── Helper ──


def _create_pdf_with_text(text: str) -> fitz.Document:
    """Create a single-page PDF containing the given text."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), text, fontsize=12)
    return doc


# ── Parse Page Range Tests ──


class TestParsePageRange:
    def test_none_returns_all(self):
        assert _parse_page_range(None, 5) == [0, 1, 2, 3, 4]

    def test_empty_string_returns_all(self):
        assert _parse_page_range("", 5) == [0, 1, 2, 3, 4]

    def test_single_page(self):
        assert _parse_page_range("3", 5) == [2]

    def test_page_range(self):
        assert _parse_page_range("2-4", 5) == [1, 2, 3]

    def test_comma_separated(self):
        assert _parse_page_range("1,3,5", 5) == [0, 2, 4]

    def test_mixed(self):
        assert _parse_page_range("1-3,5", 5) == [0, 1, 2, 4]

    def test_out_of_range_ignored(self):
        assert _parse_page_range("1,10", 5) == [0]

    def test_invalid_parts_ignored(self):
        assert _parse_page_range("abc,2", 5) == [1]

    def test_deduplication(self):
        result = _parse_page_range("1-3,2-4", 5)
        assert result == [0, 1, 2, 3]


# ── Hex Color Conversion Tests ──


class TestHexToRgb:
    def test_black(self):
        assert _hex_to_rgb_tuple("#000000") == (0.0, 0.0, 0.0)

    def test_white(self):
        r, g, b = _hex_to_rgb_tuple("#ffffff")
        assert abs(r - 1.0) < 0.01
        assert abs(g - 1.0) < 0.01
        assert abs(b - 1.0) < 0.01

    def test_red(self):
        r, g, b = _hex_to_rgb_tuple("#ff0000")
        assert abs(r - 1.0) < 0.01
        assert g == 0.0
        assert b == 0.0

    def test_without_hash(self):
        assert _hex_to_rgb_tuple("ff0000") == _hex_to_rgb_tuple("#ff0000")

    def test_invalid_returns_black(self):
        assert _hex_to_rgb_tuple("invalid") == (0.0, 0.0, 0.0)


# ── Text Extraction Tests ──


class TestExtractPageText:
    def test_extracts_text(self):
        doc = _create_pdf_with_text("Hello World Test")
        page = doc[0]
        result = _extract_page_text(page, 1)
        doc.close()

        assert result.page == 1
        assert "Hello World Test" in result.text

    def test_extracts_blocks_with_positions(self):
        doc = _create_pdf_with_text("Some sample text content here")
        page = doc[0]
        result = _extract_page_text(page, 1)
        doc.close()

        # Should have at least one block with position data
        assert len(result.blocks) >= 1
        for block in result.blocks:
            assert block.x >= 0
            assert block.y >= 0
            assert block.width > 0
            assert block.height > 0

    def test_empty_page(self):
        doc = fitz.open()
        doc.new_page(width=612, height=792)
        result = _extract_page_text(doc[0], 1)
        doc.close()

        assert result.page == 1
        assert result.text.strip() == ""
        assert len(result.blocks) == 0


# ── API Router Tests ──


@pytest.mark.asyncio
async def test_extract_text_invalid_session(client):
    resp = await client.get("/api/text/nonexistent/extract")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_search_text_invalid_session(client):
    resp = await client.get("/api/text/nonexistent/search?q=hello")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_search_text_empty_query(client, sample_pdf_file):
    # Open a file first
    resp = await client.post(
        "/api/documents/open",
        json={"file_path": str(sample_pdf_file)},
    )
    assert resp.status_code == 200
    sid = resp.json()["session_id"]

    # Search with empty query
    resp = await client.get(f"/api/text/{sid}/search?q=")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_edit_text_invalid_session(client):
    resp = await client.post(
        "/api/text/nonexistent/edit",
        json={
            "page": 1,
            "edits": [
                {
                    "x": 72,
                    "y": 72,
                    "width": 100,
                    "height": 20,
                    "text": "New text",
                }
            ],
        },
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_edit_text_invalid_page(client, sample_pdf_file):
    # Open a file first
    resp = await client.post(
        "/api/documents/open",
        json={"file_path": str(sample_pdf_file)},
    )
    assert resp.status_code == 200
    sid = resp.json()["session_id"]

    # Edit with invalid page
    resp = await client.post(
        f"/api/text/{sid}/edit",
        json={
            "page": 999,
            "edits": [
                {
                    "x": 72,
                    "y": 72,
                    "width": 100,
                    "height": 20,
                    "text": "New text",
                }
            ],
        },
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_extract_text_with_page_range(client, sample_pdf_file):
    resp = await client.post(
        "/api/documents/open",
        json={"file_path": str(sample_pdf_file)},
    )
    assert resp.status_code == 200
    sid = resp.json()["session_id"]

    resp = await client.get(f"/api/text/{sid}/extract?pages=1")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["pages"]) == 1
    assert data["pages"][0]["page"] == 1

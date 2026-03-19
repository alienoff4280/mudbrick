"""
Mudbrick v2 -- OCR Tests

Tests for OCR processing with mocked pytesseract for CI environments.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import fitz
import pytest

from app.services.ocr_engine import (
    OcrDocumentResult,
    OcrPageResult,
    OcrWord,
    _render_page_to_image,
    load_ocr_results,
    ocr_page,
    save_ocr_results,
)


# ── Helper: create a test PDF ──


def _create_test_pdf() -> fitz.Document:
    """Create a single-page PDF with some text."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "Hello World OCR Test", fontsize=12)
    return doc


# ── Rendering Tests ──


class TestRenderPageToImage:
    def test_renders_at_default_dpi(self):
        doc = _create_test_pdf()
        page = doc[0]
        img = _render_page_to_image(page, dpi=150)
        doc.close()
        assert img.mode == "RGB"
        assert img.width > 0
        assert img.height > 0

    def test_renders_at_high_dpi(self):
        doc = _create_test_pdf()
        page = doc[0]
        img_low = _render_page_to_image(page, dpi=72)
        img_high = _render_page_to_image(page, dpi=300)
        doc.close()
        # Higher DPI should produce larger image
        assert img_high.width > img_low.width
        assert img_high.height > img_low.height


# ── OCR Page Tests (mocked pytesseract) ──


MOCK_OCR_DATA = {
    "text": ["Hello", "World", "", "Test"],
    "conf": [95.0, 88.0, -1.0, 72.0],
    "left": [100, 200, 0, 300],
    "top": [50, 50, 0, 50],
    "width": [80, 90, 0, 70],
    "height": [20, 20, 0, 20],
    "block_num": [1, 1, 0, 1],
    "line_num": [1, 1, 0, 1],
    "word_num": [1, 2, 0, 3],
}


class TestOcrPage:
    @patch("app.services.ocr_engine.pytesseract")
    def test_ocr_page_returns_words(self, mock_pytesseract):
        mock_pytesseract.Output.DICT = "dict"
        mock_pytesseract.image_to_data.return_value = MOCK_OCR_DATA

        doc = _create_test_pdf()
        page = doc[0]
        result = ocr_page(page, page_num=1, language="eng", dpi=150)
        doc.close()

        assert isinstance(result, OcrPageResult)
        assert result.page == 1
        # 3 valid words (Hello, World, Test -- empty string skipped, -1 conf skipped)
        assert result.word_count == 3
        assert result.avg_confidence > 0
        assert result.language == "eng"

        # Check individual words
        texts = [w.text for w in result.words]
        assert "Hello" in texts
        assert "World" in texts
        assert "Test" in texts

    @patch("app.services.ocr_engine.pytesseract")
    def test_ocr_page_confidence_normalized(self, mock_pytesseract):
        mock_pytesseract.Output.DICT = "dict"
        mock_pytesseract.image_to_data.return_value = MOCK_OCR_DATA

        doc = _create_test_pdf()
        result = ocr_page(doc[0], page_num=1, dpi=150)
        doc.close()

        for word in result.words:
            assert 0.0 <= word.confidence <= 1.0

    @patch("app.services.ocr_engine.pytesseract")
    def test_ocr_page_coordinates_in_pdf_space(self, mock_pytesseract):
        mock_pytesseract.Output.DICT = "dict"
        mock_pytesseract.image_to_data.return_value = MOCK_OCR_DATA

        doc = _create_test_pdf()
        page = doc[0]
        result = ocr_page(page, page_num=1, dpi=150)
        doc.close()

        page_rect = doc[0].rect if not doc.is_closed else None
        for word in result.words:
            # Coordinates should be reasonable PDF points
            assert word.x >= 0
            assert word.y >= 0
            assert word.width > 0
            assert word.height > 0

    @patch("app.services.ocr_engine.pytesseract", None)
    def test_ocr_page_raises_without_pytesseract(self):
        doc = _create_test_pdf()
        with pytest.raises(RuntimeError, match="pytesseract is not installed"):
            ocr_page(doc[0], page_num=1)
        doc.close()


# ── Results Caching Tests ──


class TestOcrResultsCaching:
    def test_save_and_load_results(self, tmp_path):
        result = OcrDocumentResult(
            pages=[
                OcrPageResult(
                    page=1,
                    words=[
                        OcrWord(
                            text="Hello",
                            confidence=0.95,
                            x=72.0,
                            y=72.0,
                            width=50.0,
                            height=12.0,
                        ),
                    ],
                    word_count=1,
                    avg_confidence=0.95,
                ),
            ],
            total_words=1,
            avg_confidence=0.95,
        )

        save_ocr_results(tmp_path, result)
        loaded = load_ocr_results(tmp_path)

        assert loaded is not None
        assert loaded.total_words == 1
        assert loaded.avg_confidence == 0.95
        assert len(loaded.pages) == 1
        assert loaded.pages[0].word_count == 1
        assert loaded.pages[0].words[0].text == "Hello"

    def test_load_nonexistent_returns_none(self, tmp_path):
        result = load_ocr_results(tmp_path)
        assert result is None


# ── API Router Tests ──


@pytest.mark.asyncio
async def test_get_ocr_results_no_session(client):
    resp = await client.get("/api/ocr/nonexistent/results")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_ocr_requires_valid_session(client):
    resp = await client.post(
        "/api/ocr/nonexistent",
        json={"language": "eng"},
    )
    # SSE endpoint returns 404 for invalid session
    assert resp.status_code == 404

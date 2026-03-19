"""
Mudbrick v2 -- Comprehensive OCR Engine Unit Tests

Tests for page rendering, pytesseract invocation (mocked), result parsing,
confidence scores, and caching.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import fitz
import pytest
from PIL import Image

from app.services.ocr_engine import (
    OcrDocumentResult,
    OcrPageResult,
    OcrWord,
    _render_page_to_image,
    load_ocr_results,
    ocr_page,
    save_ocr_results,
)


def _create_test_pdf(text: str = "Hello World OCR Test") -> fitz.Document:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), text, fontsize=12)
    return doc


MOCK_OCR_DATA = {
    "text": ["Hello", "World", "", "Test", ""],
    "conf": [95.0, 88.0, -1.0, 72.0, 50.0],
    "left": [100, 200, 0, 300, 400],
    "top": [50, 50, 0, 50, 50],
    "width": [80, 90, 0, 70, 60],
    "height": [20, 20, 0, 20, 20],
    "block_num": [1, 1, 0, 1, 2],
    "line_num": [1, 1, 0, 1, 1],
    "word_num": [1, 2, 0, 3, 1],
}


class TestRenderPageToImage:
    def test_returns_pil_image(self):
        doc = _create_test_pdf()
        img = _render_page_to_image(doc[0], dpi=72)
        doc.close()
        assert isinstance(img, Image.Image)
        assert img.mode == "RGB"

    def test_higher_dpi_larger_image(self):
        doc = _create_test_pdf()
        img_low = _render_page_to_image(doc[0], dpi=72)
        img_high = _render_page_to_image(doc[0], dpi=300)
        doc.close()
        assert img_high.width > img_low.width
        assert img_high.height > img_low.height

    def test_image_dimensions_proportional_to_dpi(self):
        doc = _create_test_pdf()
        img72 = _render_page_to_image(doc[0], dpi=72)
        img144 = _render_page_to_image(doc[0], dpi=144)
        doc.close()
        # Should be roughly 2x
        assert abs(img144.width / img72.width - 2.0) < 0.1
        assert abs(img144.height / img72.height - 2.0) < 0.1


class TestOcrPageMocked:
    @patch("app.services.ocr_engine.pytesseract")
    def test_filters_empty_and_negative_conf(self, mock_tess):
        mock_tess.Output.DICT = "dict"
        mock_tess.image_to_data.return_value = MOCK_OCR_DATA

        doc = _create_test_pdf()
        result = ocr_page(doc[0], page_num=1, dpi=72)
        doc.close()

        # Empty text and -1 conf are filtered
        texts = [w.text for w in result.words]
        assert "" not in texts
        # Should have Hello, World, Test (3 valid + possibly the 5th with empty text)
        assert result.word_count >= 3

    @patch("app.services.ocr_engine.pytesseract")
    def test_normalizes_confidence_to_0_1(self, mock_tess):
        mock_tess.Output.DICT = "dict"
        mock_tess.image_to_data.return_value = MOCK_OCR_DATA

        doc = _create_test_pdf()
        result = ocr_page(doc[0], page_num=1, dpi=72)
        doc.close()

        for word in result.words:
            assert 0.0 <= word.confidence <= 1.0

    @patch("app.services.ocr_engine.pytesseract")
    def test_coordinates_in_pdf_space(self, mock_tess):
        mock_tess.Output.DICT = "dict"
        mock_tess.image_to_data.return_value = MOCK_OCR_DATA

        doc = _create_test_pdf()
        result = ocr_page(doc[0], page_num=1, dpi=72)
        doc.close()

        for word in result.words:
            assert word.x >= 0
            assert word.y >= 0
            assert word.width > 0
            assert word.height > 0
            # Should be within page bounds (612x792 at 72 dpi = 1:1)
            assert word.x < 700
            assert word.y < 900

    @patch("app.services.ocr_engine.pytesseract")
    def test_average_confidence_computed(self, mock_tess):
        mock_tess.Output.DICT = "dict"
        mock_tess.image_to_data.return_value = MOCK_OCR_DATA

        doc = _create_test_pdf()
        result = ocr_page(doc[0], page_num=1, dpi=72)
        doc.close()

        assert result.avg_confidence > 0
        assert result.avg_confidence <= 1.0

    @patch("app.services.ocr_engine.pytesseract")
    def test_preserves_block_line_word_nums(self, mock_tess):
        mock_tess.Output.DICT = "dict"
        mock_tess.image_to_data.return_value = MOCK_OCR_DATA

        doc = _create_test_pdf()
        result = ocr_page(doc[0], page_num=1, dpi=72)
        doc.close()

        hello = next((w for w in result.words if w.text == "Hello"), None)
        assert hello is not None
        assert hello.block_num == 1
        assert hello.line_num == 1
        assert hello.word_num == 1

    @patch("app.services.ocr_engine.pytesseract")
    def test_custom_language(self, mock_tess):
        mock_tess.Output.DICT = "dict"
        mock_tess.image_to_data.return_value = MOCK_OCR_DATA

        doc = _create_test_pdf()
        result = ocr_page(doc[0], page_num=1, language="deu", dpi=72)
        doc.close()

        assert result.language == "deu"
        mock_tess.image_to_data.assert_called_once()
        call_kwargs = mock_tess.image_to_data.call_args
        assert call_kwargs[1]["lang"] == "deu"

    @patch("app.services.ocr_engine.pytesseract", None)
    def test_raises_without_pytesseract(self):
        doc = _create_test_pdf()
        with pytest.raises(RuntimeError, match="pytesseract is not installed"):
            ocr_page(doc[0], page_num=1)
        doc.close()

    @patch("app.services.ocr_engine.pytesseract")
    def test_empty_ocr_results(self, mock_tess):
        mock_tess.Output.DICT = "dict"
        mock_tess.image_to_data.return_value = {
            "text": ["", ""],
            "conf": [-1.0, -1.0],
            "left": [0, 0],
            "top": [0, 0],
            "width": [0, 0],
            "height": [0, 0],
            "block_num": [0, 0],
            "line_num": [0, 0],
            "word_num": [0, 0],
        }

        doc = _create_test_pdf()
        result = ocr_page(doc[0], page_num=1, dpi=72)
        doc.close()

        assert result.word_count == 0
        assert result.avg_confidence == 0.0


class TestOcrResultsCaching:
    def test_round_trip_single_page(self, tmp_path):
        result = OcrDocumentResult(
            pages=[
                OcrPageResult(
                    page=1,
                    words=[
                        OcrWord(text="Hello", confidence=0.95, x=72, y=72, width=50, height=12),
                        OcrWord(text="World", confidence=0.88, x=130, y=72, width=60, height=12),
                    ],
                    word_count=2,
                    avg_confidence=0.915,
                ),
            ],
            total_words=2,
            avg_confidence=0.915,
        )
        save_ocr_results(tmp_path, result)
        loaded = load_ocr_results(tmp_path)

        assert loaded is not None
        assert loaded.total_words == 2
        assert loaded.avg_confidence == 0.915
        assert len(loaded.pages) == 1
        assert loaded.pages[0].words[0].text == "Hello"
        assert loaded.pages[0].words[1].text == "World"

    def test_round_trip_multi_page(self, tmp_path):
        pages = [
            OcrPageResult(
                page=i + 1,
                words=[OcrWord(text=f"Word{i}", confidence=0.9, x=0, y=0, width=10, height=10)],
                word_count=1,
                avg_confidence=0.9,
            )
            for i in range(5)
        ]
        result = OcrDocumentResult(pages=pages, total_words=5, avg_confidence=0.9)
        save_ocr_results(tmp_path, result)
        loaded = load_ocr_results(tmp_path)

        assert loaded is not None
        assert len(loaded.pages) == 5
        assert loaded.total_words == 5

    def test_load_nonexistent(self, tmp_path):
        assert load_ocr_results(tmp_path / "nonexistent") is None

    def test_saved_file_is_valid_json(self, tmp_path):
        result = OcrDocumentResult(pages=[], total_words=0, avg_confidence=0.0)
        path = save_ocr_results(tmp_path, result)
        data = json.loads(path.read_text(encoding="utf-8"))
        assert "pages" in data
        assert "total_words" in data

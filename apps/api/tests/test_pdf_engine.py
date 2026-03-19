"""
Mudbrick v2 -- Tests for PDF Engine Core
"""

from __future__ import annotations

import pytest
import fitz

from app.services.pdf_engine import PdfEngine, PageInfo, DocumentInfo


@pytest.fixture
def single_page_doc() -> fitz.Document:
    """Create a single-page test PDF document."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "Test content", fontsize=12)
    return doc


@pytest.fixture
def multi_page_doc() -> fitz.Document:
    """Create a 3-page test PDF document."""
    doc = fitz.open()
    for i in range(3):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 72), f"Page {i + 1}", fontsize=12)
    return doc


@pytest.fixture
def single_page_bytes(single_page_doc: fitz.Document) -> bytes:
    return single_page_doc.tobytes()


@pytest.fixture
def multi_page_bytes(multi_page_doc: fitz.Document) -> bytes:
    return multi_page_doc.tobytes()


class TestPdfEngineOpen:
    def test_open_from_bytes(self, single_page_bytes: bytes):
        doc = PdfEngine.open_from_bytes(single_page_bytes)
        assert doc.page_count == 1
        doc.close()

    def test_open_from_bytes_multi_page(self, multi_page_bytes: bytes):
        doc = PdfEngine.open_from_bytes(multi_page_bytes)
        assert doc.page_count == 3
        doc.close()

    def test_open_invalid_bytes(self):
        with pytest.raises(Exception):
            PdfEngine.open_from_bytes(b"not a pdf")


class TestPdfEngineInfo:
    def test_get_document_info(self, single_page_doc: fitz.Document):
        info = PdfEngine.get_document_info(single_page_doc, file_size=1000)
        assert info.page_count == 1
        assert info.file_size == 1000
        assert len(info.pages) == 1
        assert info.pages[0].width == 612
        assert info.pages[0].height == 792

    def test_get_page_count(self, multi_page_doc: fitz.Document):
        assert PdfEngine.get_page_count(multi_page_doc) == 3

    def test_get_page_dimensions(self, single_page_doc: fitz.Document):
        w, h = PdfEngine.get_page_dimensions(single_page_doc, 0)
        assert w == 612
        assert h == 792

    def test_get_page_dimensions_out_of_range(self, single_page_doc: fitz.Document):
        with pytest.raises(IndexError):
            PdfEngine.get_page_dimensions(single_page_doc, 5)


class TestPdfEngineRender:
    def test_render_page_to_image(self, single_page_doc: fitz.Document):
        png_bytes = PdfEngine.render_page_to_image(single_page_doc, 0, dpi=72)
        # PNG magic bytes
        assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n"

    def test_render_thumbnail(self, single_page_doc: fitz.Document):
        png_bytes = PdfEngine.render_thumbnail(single_page_doc, 0, width=100)
        assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n"

    def test_render_out_of_range(self, single_page_doc: fitz.Document):
        with pytest.raises(IndexError):
            PdfEngine.render_page_to_image(single_page_doc, 5)


class TestPdfEngineMutations:
    def test_rotate_page(self, single_page_doc: fitz.Document):
        PdfEngine.rotate_page(single_page_doc, 0, 90)
        assert single_page_doc[0].rotation == 90

    def test_rotate_page_cumulative(self, single_page_doc: fitz.Document):
        PdfEngine.rotate_page(single_page_doc, 0, 90)
        PdfEngine.rotate_page(single_page_doc, 0, 90)
        assert single_page_doc[0].rotation == 180

    def test_rotate_invalid_degrees(self, single_page_doc: fitz.Document):
        with pytest.raises(ValueError, match="multiple of 90"):
            PdfEngine.rotate_page(single_page_doc, 0, 45)

    def test_delete_page(self, multi_page_doc: fitz.Document):
        assert multi_page_doc.page_count == 3
        PdfEngine.delete_page(multi_page_doc, 1)
        assert multi_page_doc.page_count == 2

    def test_delete_page_out_of_range(self, single_page_doc: fitz.Document):
        with pytest.raises(IndexError):
            PdfEngine.delete_page(single_page_doc, 5)

    def test_reorder_pages(self, multi_page_doc: fitz.Document):
        PdfEngine.reorder_pages(multi_page_doc, [2, 0, 1])
        assert multi_page_doc.page_count == 3

    def test_reorder_invalid(self, multi_page_doc: fitz.Document):
        with pytest.raises(ValueError, match="permutation"):
            PdfEngine.reorder_pages(multi_page_doc, [0, 0, 1])

    def test_insert_blank_page(self, single_page_doc: fitz.Document):
        assert single_page_doc.page_count == 1
        PdfEngine.insert_blank_page(single_page_doc, after=0)
        assert single_page_doc.page_count == 2

    def test_crop_page(self, single_page_doc: fitz.Document):
        PdfEngine.crop_page(single_page_doc, 0, 100, 100, 400, 600)
        page = single_page_doc[0]
        cropbox = page.cropbox
        assert abs(cropbox.x0 - 100) < 1
        assert abs(cropbox.y0 - 100) < 1

    def test_crop_page_out_of_range(self, single_page_doc: fitz.Document):
        with pytest.raises(IndexError):
            PdfEngine.crop_page(single_page_doc, 5, 0, 0, 100, 100)


class TestPdfEngineMerge:
    def test_merge_documents(self):
        doc1 = fitz.open()
        doc1.new_page(width=612, height=792)
        doc2 = fitz.open()
        doc2.new_page(width=612, height=792)
        doc2.new_page(width=612, height=792)

        merged = PdfEngine.merge_documents([doc1, doc2])
        assert merged.page_count == 3

        doc1.close()
        doc2.close()
        merged.close()

    def test_merge_empty(self):
        with pytest.raises(ValueError, match="No documents"):
            PdfEngine.merge_documents([])


class TestPdfEngineSave:
    def test_save_to_bytes(self, single_page_doc: fitz.Document):
        data = PdfEngine.save_to_bytes(single_page_doc)
        assert data[:5] == b"%PDF-"
        # Should be able to reopen
        reopened = fitz.open(stream=data, filetype="pdf")
        assert reopened.page_count == 1
        reopened.close()

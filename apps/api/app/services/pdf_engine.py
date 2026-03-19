"""
Mudbrick v2 -- PDF Engine Core

PyMuPDF (fitz) wrapper for common PDF operations:
open, page count, page dimensions, render to image, save.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Optional

import fitz  # PyMuPDF


@dataclass
class PageInfo:
    """Information about a single PDF page."""

    number: int  # 0-indexed
    width: float
    height: float
    rotation: int


@dataclass
class DocumentInfo:
    """Summary information about a PDF document."""

    page_count: int
    pages: list[PageInfo]
    metadata: dict[str, str]
    file_size: int


class PdfEngine:
    """PyMuPDF wrapper for PDF operations."""

    @staticmethod
    def open_from_bytes(data: bytes) -> fitz.Document:
        """Open a PDF document from bytes."""
        doc = fitz.open(stream=data, filetype="pdf")
        if doc.is_encrypted:
            raise ValueError("Encrypted PDFs are not supported without a password")
        return doc

    @staticmethod
    def open_from_file(path: str) -> fitz.Document:
        """Open a PDF document from a file path."""
        doc = fitz.open(path)
        if doc.is_encrypted:
            raise ValueError("Encrypted PDFs are not supported without a password")
        return doc

    @staticmethod
    def get_document_info(doc: fitz.Document, file_size: int = 0) -> DocumentInfo:
        """Get summary information about a document."""
        pages: list[PageInfo] = []
        for i in range(doc.page_count):
            page = doc[i]
            rect = page.rect
            pages.append(
                PageInfo(
                    number=i,
                    width=rect.width,
                    height=rect.height,
                    rotation=page.rotation,
                )
            )
        return DocumentInfo(
            page_count=doc.page_count,
            pages=pages,
            metadata=dict(doc.metadata) if doc.metadata else {},
            file_size=file_size,
        )

    @staticmethod
    def get_page_count(doc: fitz.Document) -> int:
        """Get the number of pages in a document."""
        return doc.page_count

    @staticmethod
    def get_page_dimensions(doc: fitz.Document, page_num: int) -> tuple[float, float]:
        """Get the dimensions (width, height) of a page (0-indexed)."""
        if page_num < 0 or page_num >= doc.page_count:
            raise IndexError(f"Page {page_num} out of range (0-{doc.page_count - 1})")
        page = doc[page_num]
        return (page.rect.width, page.rect.height)

    @staticmethod
    def render_page_to_image(
        doc: fitz.Document,
        page_num: int,
        dpi: int = 150,
        alpha: bool = False,
    ) -> bytes:
        """Render a page to PNG image bytes.

        Args:
            doc: The PDF document.
            page_num: 0-indexed page number.
            dpi: Resolution in dots per inch (default 150).
            alpha: Include alpha channel (default False).

        Returns:
            PNG image as bytes.
        """
        if page_num < 0 or page_num >= doc.page_count:
            raise IndexError(f"Page {page_num} out of range (0-{doc.page_count - 1})")

        page = doc[page_num]
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=alpha)
        return pix.tobytes("png")

    @staticmethod
    def render_thumbnail(
        doc: fitz.Document, page_num: int, width: int = 200
    ) -> bytes:
        """Render a page thumbnail at a given width, maintaining aspect ratio.

        Args:
            doc: The PDF document.
            page_num: 0-indexed page number.
            width: Target thumbnail width in pixels (default 200).

        Returns:
            PNG image as bytes.
        """
        if page_num < 0 or page_num >= doc.page_count:
            raise IndexError(f"Page {page_num} out of range (0-{doc.page_count - 1})")

        page = doc[page_num]
        rect = page.rect
        zoom = width / rect.width
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        return pix.tobytes("png")

    @staticmethod
    def save_to_bytes(doc: fitz.Document, garbage: int = 3, deflate: bool = True) -> bytes:
        """Save the document to bytes.

        Args:
            doc: The PDF document.
            garbage: Garbage collection level (0-4). 3 = compact xref table.
            deflate: Compress streams (default True).

        Returns:
            PDF bytes.
        """
        return doc.tobytes(garbage=garbage, deflate=deflate)

    @staticmethod
    def rotate_page(doc: fitz.Document, page_num: int, degrees: int) -> None:
        """Rotate a page by the specified degrees (must be multiple of 90)."""
        if degrees % 90 != 0:
            raise ValueError("Rotation must be a multiple of 90 degrees")
        if page_num < 0 or page_num >= doc.page_count:
            raise IndexError(f"Page {page_num} out of range (0-{doc.page_count - 1})")
        page = doc[page_num]
        page.set_rotation((page.rotation + degrees) % 360)

    @staticmethod
    def delete_page(doc: fitz.Document, page_num: int) -> None:
        """Delete a page from the document (0-indexed)."""
        if page_num < 0 or page_num >= doc.page_count:
            raise IndexError(f"Page {page_num} out of range (0-{doc.page_count - 1})")
        doc.delete_page(page_num)

    @staticmethod
    def reorder_pages(doc: fitz.Document, new_order: list[int]) -> None:
        """Reorder pages according to the given list of 0-indexed page numbers.

        Example: [2, 0, 1] moves page 3 first, then page 1, then page 2.
        """
        if sorted(new_order) != list(range(doc.page_count)):
            raise ValueError(
                f"new_order must be a permutation of 0-{doc.page_count - 1}"
            )
        doc.select(new_order)

    @staticmethod
    def insert_blank_page(
        doc: fitz.Document,
        after: int = -1,
        width: float = 612,
        height: float = 792,
    ) -> None:
        """Insert a blank page after the specified page (0-indexed).

        Args:
            doc: The PDF document.
            after: Insert after this page (-1 = at beginning).
            width: Page width in points (default 612 = US Letter).
            height: Page height in points (default 792 = US Letter).
        """
        doc.new_page(pno=after, width=width, height=height)

    @staticmethod
    def merge_documents(docs: list[fitz.Document]) -> fitz.Document:
        """Merge multiple documents into a new document.

        Args:
            docs: List of PDF documents to merge.

        Returns:
            New merged PDF document.
        """
        if not docs:
            raise ValueError("No documents to merge")

        result = fitz.open()
        for doc in docs:
            result.insert_pdf(doc)
        return result

    @staticmethod
    def crop_page(
        doc: fitz.Document,
        page_num: int,
        x: float,
        y: float,
        width: float,
        height: float,
    ) -> None:
        """Crop a page to the specified rectangle.

        Args:
            doc: The PDF document.
            page_num: 0-indexed page number.
            x, y: Top-left corner of crop box.
            width, height: Size of crop box.
        """
        if page_num < 0 or page_num >= doc.page_count:
            raise IndexError(f"Page {page_num} out of range (0-{doc.page_count - 1})")

        page = doc[page_num]
        crop_rect = fitz.Rect(x, y, x + width, y + height)
        page.set_cropbox(crop_rect)

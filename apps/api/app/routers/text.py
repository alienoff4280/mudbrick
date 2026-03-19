"""
Mudbrick v2 -- Text Router

GET  /api/text/{sid}/extract  -- Extract text per page with positions
GET  /api/text/{sid}/search   -- Search text, return page + position matches
POST /api/text/{sid}/edit     -- Edit text via cover-and-replace
"""

from __future__ import annotations

from typing import Optional

import fitz  # PyMuPDF
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..dependencies import get_session_manager
from ..services.pdf_engine import PdfEngine
from ..services.session_manager import SessionManager

router = APIRouter(prefix="/api/text", tags=["text"])


# ── Models ──


class TextBlock(BaseModel):
    """A block of text extracted from a PDF page."""

    text: str
    x: float
    y: float
    width: float
    height: float
    font: str = ""
    size: float = 0.0
    color: str = "#000000"


class PageText(BaseModel):
    """Extracted text for a single page."""

    page: int  # 1-indexed
    text: str  # Full text content
    blocks: list[TextBlock]


class TextExtractResponse(BaseModel):
    """Response from text extraction."""

    pages: list[PageText]
    total_pages: int


class SearchMatch(BaseModel):
    """A single search match."""

    page: int  # 1-indexed
    text: str  # The matched text snippet
    rects: list[dict]  # Bounding rectangles [{"x", "y", "width", "height"}]
    context: str = ""  # Surrounding text for preview


class TextSearchResponse(BaseModel):
    """Response from text search."""

    query: str
    matches: list[SearchMatch]
    total: int


class TextEdit(BaseModel):
    """A single text edit operation."""

    x: float = Field(..., description="X coordinate of the text region")
    y: float = Field(..., description="Y coordinate of the text region")
    width: float = Field(..., description="Width of the text region")
    height: float = Field(..., description="Height of the text region")
    text: str = Field(..., description="New text content")
    font: str = Field("helv", description="Font name (PyMuPDF font name)")
    size: float = Field(12.0, description="Font size in points")
    color: str = Field("#000000", description="Text color as hex string")
    bg_color: str = Field("#ffffff", description="Background color as hex string")


class TextEditRequest(BaseModel):
    """Request to edit text on a specific page."""

    page: int = Field(..., description="Page number (1-indexed)")
    edits: list[TextEdit]


class TextEditResponse(BaseModel):
    """Response from text editing."""

    success: bool
    edits_applied: int
    new_version: int


# ── Helpers ──


def _hex_to_rgb_tuple(hex_color: str) -> tuple[float, float, float]:
    """Convert a hex color string to a (r, g, b) tuple with values 0.0-1.0."""
    hex_color = hex_color.lstrip("#")
    if len(hex_color) != 6:
        return (0.0, 0.0, 0.0)
    r = int(hex_color[0:2], 16) / 255.0
    g = int(hex_color[2:4], 16) / 255.0
    b = int(hex_color[4:6], 16) / 255.0
    return (r, g, b)


def _extract_page_text(page: fitz.Page, page_num: int) -> PageText:
    """Extract structured text from a single PDF page using PyMuPDF."""
    text_dict = page.get_text("dict")
    full_text = page.get_text("text")

    blocks: list[TextBlock] = []
    for block in text_dict.get("blocks", []):
        if block.get("type") != 0:  # type 0 = text block
            continue

        block_rect = fitz.Rect(block["bbox"])

        for line in block.get("lines", []):
            for span in line.get("spans", []):
                span_text = span.get("text", "").strip()
                if not span_text:
                    continue

                span_rect = fitz.Rect(span["bbox"])
                font = span.get("font", "")
                size = span.get("size", 0.0)

                # Convert color int to hex
                color_int = span.get("color", 0)
                r = (color_int >> 16) & 0xFF
                g = (color_int >> 8) & 0xFF
                b = color_int & 0xFF
                color_hex = f"#{r:02x}{g:02x}{b:02x}"

                blocks.append(
                    TextBlock(
                        text=span_text,
                        x=float(span_rect.x0),
                        y=float(span_rect.y0),
                        width=float(span_rect.width),
                        height=float(span_rect.height),
                        font=font,
                        size=round(size, 1),
                        color=color_hex,
                    )
                )

    return PageText(
        page=page_num,
        text=full_text,
        blocks=blocks,
    )


# ── Endpoints ──


@router.get("/{sid}/extract", response_model=TextExtractResponse)
async def extract_text(
    sid: str,
    pages: Optional[str] = Query(
        None,
        description="Page range: '1-5', '1,3,5', or None for all pages",
    ),
    sm: SessionManager = Depends(get_session_manager),
):
    """Extract text from PDF pages with position information.

    Returns structured text blocks with coordinates, font, size, and color.
    """
    session = sm.get_session(sid)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {sid}")

    pdf_path = sm.get_current_pdf_path(sid)
    if pdf_path is None:
        raise HTTPException(status_code=404, detail="No PDF found for session")

    doc = PdfEngine.open_from_file(str(pdf_path))
    try:
        # Parse page range
        page_indices = _parse_page_range(pages, doc.page_count)

        result_pages: list[PageText] = []
        for page_idx in page_indices:
            page = doc[page_idx]
            page_num = page_idx + 1
            result_pages.append(_extract_page_text(page, page_num))

        return TextExtractResponse(
            pages=result_pages,
            total_pages=doc.page_count,
        )
    finally:
        doc.close()


@router.get("/{sid}/search", response_model=TextSearchResponse)
async def search_text(
    sid: str,
    q: str = Query(..., description="Search query text"),
    sm: SessionManager = Depends(get_session_manager),
):
    """Search for text across all pages.

    Returns matches with page numbers, text snippets, and bounding rectangles
    for highlighting in the viewer.
    """
    session = sm.get_session(sid)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {sid}")

    pdf_path = sm.get_current_pdf_path(sid)
    if pdf_path is None:
        raise HTTPException(status_code=404, detail="No PDF found for session")

    if not q.strip():
        return TextSearchResponse(query=q, matches=[], total=0)

    doc = PdfEngine.open_from_file(str(pdf_path))
    try:
        matches: list[SearchMatch] = []

        for page_idx in range(doc.page_count):
            page = doc[page_idx]
            page_num = page_idx + 1

            # Use PyMuPDF's search_for which returns Rect list
            quads = page.search_for(q)
            if not quads:
                continue

            # Get surrounding context from page text
            page_text = page.get_text("text")
            lower_text = page_text.lower()
            lower_q = q.lower()
            context = ""
            idx = lower_text.find(lower_q)
            if idx >= 0:
                start = max(0, idx - 40)
                end = min(len(page_text), idx + len(q) + 40)
                context = page_text[start:end].strip()
                if start > 0:
                    context = "..." + context
                if end < len(page_text):
                    context = context + "..."

            rects = [
                {
                    "x": float(rect.x0),
                    "y": float(rect.y0),
                    "width": float(rect.width),
                    "height": float(rect.height),
                }
                for rect in quads
            ]

            matches.append(
                SearchMatch(
                    page=page_num,
                    text=q,
                    rects=rects,
                    context=context,
                )
            )

        return TextSearchResponse(
            query=q,
            matches=matches,
            total=len(matches),
        )
    finally:
        doc.close()


@router.post("/{sid}/edit", response_model=TextEditResponse)
async def edit_text(
    sid: str,
    request: TextEditRequest,
    sm: SessionManager = Depends(get_session_manager),
):
    """Edit text on a specific page using cover-and-replace.

    For each edit:
    1. Draw a filled rectangle (background color) over the original text region
    2. Draw new text on top of the rectangle

    This produces a visual replacement. The original text is covered, not removed.
    For forensic removal, use the redaction endpoint.
    """
    session = sm.get_session(sid)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {sid}")

    pdf_path = sm.get_current_pdf_path(sid)
    if pdf_path is None:
        raise HTTPException(status_code=404, detail="No PDF found for session")

    page_idx = request.page - 1

    doc = PdfEngine.open_from_file(str(pdf_path))
    try:
        if page_idx < 0 or page_idx >= doc.page_count:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid page number: {request.page}",
            )

        page = doc[page_idx]
        edits_applied = 0

        for edit in request.edits:
            # 1. Draw background rectangle to cover original text
            bg_rect = fitz.Rect(
                edit.x,
                edit.y,
                edit.x + edit.width,
                edit.y + edit.height,
            )
            bg_color = _hex_to_rgb_tuple(edit.bg_color)
            shape = page.new_shape()
            shape.draw_rect(bg_rect)
            shape.finish(fill=bg_color, color=bg_color)
            shape.commit()

            # 2. Draw new text on top
            text_color = _hex_to_rgb_tuple(edit.color)
            # Position text slightly inside the rectangle
            text_point = fitz.Point(edit.x + 1, edit.y + edit.size)

            page.insert_text(
                text_point,
                edit.text,
                fontname=edit.font,
                fontsize=edit.size,
                color=text_color,
            )

            edits_applied += 1

        # Save modified PDF
        pdf_bytes = doc.tobytes()
        new_version = sm.save_current_pdf(sid, pdf_bytes, "text_edit")

        return TextEditResponse(
            success=True,
            edits_applied=edits_applied,
            new_version=new_version,
        )
    finally:
        doc.close()


# ── Helpers ──


def _parse_page_range(pages_str: Optional[str], total_pages: int) -> list[int]:
    """Parse a page range string into a list of 0-indexed page numbers.

    Supports: "1-5", "1,3,5", "1-3,7,9-10", None (all pages).
    """
    if not pages_str:
        return list(range(total_pages))

    indices: set[int] = set()
    parts = pages_str.split(",")

    for part in parts:
        part = part.strip()
        if "-" in part:
            try:
                start, end = part.split("-", 1)
                start_num = int(start.strip())
                end_num = int(end.strip())
                for p in range(start_num, end_num + 1):
                    if 1 <= p <= total_pages:
                        indices.add(p - 1)
            except ValueError:
                continue
        else:
            try:
                p = int(part)
                if 1 <= p <= total_pages:
                    indices.add(p - 1)
            except ValueError:
                continue

    return sorted(indices)

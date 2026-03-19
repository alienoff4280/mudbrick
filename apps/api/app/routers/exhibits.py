"""
Mudbrick v2 -- Exhibits Router

Exhibit stamp numbering and page label management.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..dependencies import get_session_manager
from ..services.legal_text import (
    BatesOptions,
    apply_bates_numbers,
    resolve_font_name,
    parse_hex_color,
    inches_to_points,
    text_box_height,
    build_text_rect,
    POSITION_ALIGNS,
)
from ..services.pdf_engine import PdfEngine
from ..services.session_manager import SessionManager

import fitz

router = APIRouter(prefix="/api/exhibits", tags=["exhibits"])


class ExhibitStampRequest(BaseModel):
    format: str = Field(
        default="Exhibit {num}",
        description="Format string for exhibit label. Use {num} for the number.",
    )
    start_num: int = 1
    position: str = "top-center"
    font: str = "HelveticaBold"
    font_size: float = 14
    color: str = "#000000"
    bg_color: str = ""
    margin: float = Field(default=0.5, description="Margin in inches")
    pages: list[int] = Field(
        default_factory=list,
        description="Specific page numbers to stamp (1-indexed). Empty = all pages.",
    )


class ExhibitStampResponse(BaseModel):
    success: bool = True
    labels: list[str] = []
    page_count: int


class PageLabelEntry(BaseModel):
    page: int
    label: str


class PageLabelsRequest(BaseModel):
    labels: list[PageLabelEntry]


class PageLabelsResponse(BaseModel):
    success: bool = True
    page_count: int


class PageLabelsGetResponse(BaseModel):
    labels: dict[int, str]
    page_count: int


@router.post("/{sid}/stamp", response_model=ExhibitStampResponse)
async def apply_exhibit_stamps(
    sid: str,
    request: ExhibitStampRequest,
    sm: SessionManager = Depends(get_session_manager),
):
    """Apply exhibit stamp labels to specified pages."""
    pdf_bytes = sm.get_current_pdf_bytes(sid)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="Session not found")

    doc = PdfEngine.open_from_bytes(pdf_bytes)
    try:
        font_name = resolve_font_name(request.font)
        color = parse_hex_color(request.color)
        margin_pts = inches_to_points(request.margin)
        box_height = text_box_height(request.font_size)

        # Determine which pages to stamp
        if request.pages:
            page_indices = [p - 1 for p in request.pages if 1 <= p <= doc.page_count]
        else:
            page_indices = list(range(doc.page_count))

        if not page_indices:
            raise ValueError("No valid pages specified for exhibit stamps")

        labels: list[str] = []
        num = request.start_num

        for index in page_indices:
            page = doc[index]
            label = request.format.replace("{num}", str(num))
            rect = build_text_rect(page.rect, request.position, margin_pts, box_height)

            # Optional background fill
            if request.bg_color and request.bg_color != "transparent":
                bg_rgb = parse_hex_color(request.bg_color)
                page.draw_rect(rect, color=bg_rgb, fill=bg_rgb)

            inserted = page.insert_textbox(
                rect,
                label,
                fontname=font_name,
                fontsize=request.font_size,
                color=color,
                align=POSITION_ALIGNS.get(request.position, fitz.TEXT_ALIGN_CENTER),
                overlay=True,
            )
            if inserted < 0:
                raise ValueError(f"Exhibit label did not fit on page {index + 1}")

            labels.append(label)
            num += 1

        new_bytes = PdfEngine.save_to_bytes(doc)
        page_count = doc.page_count
    finally:
        doc.close()

    sm.save_current_pdf(sid, new_bytes, "apply exhibit stamps")

    return ExhibitStampResponse(
        labels=labels,
        page_count=page_count,
    )


@router.post("/{sid}", response_model=ExhibitStampResponse)
async def apply_exhibit_stamps_default(
    sid: str,
    request: ExhibitStampRequest,
    sm: SessionManager = Depends(get_session_manager),
):
    """Apply exhibit stamps (alias for /stamp)."""
    return await apply_exhibit_stamps(sid, request, sm)


@router.get("/{sid}/labels", response_model=PageLabelsGetResponse)
async def get_page_labels(
    sid: str,
    sm: SessionManager = Depends(get_session_manager),
):
    """Get current page labels from the PDF."""
    pdf_bytes = sm.get_current_pdf_bytes(sid)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="Session not found")

    doc = PdfEngine.open_from_bytes(pdf_bytes)
    try:
        labels: dict[int, str] = {}
        for i in range(doc.page_count):
            page_label = doc[i].get_label()
            if page_label:
                labels[i + 1] = page_label
        page_count = doc.page_count
    finally:
        doc.close()

    return PageLabelsGetResponse(labels=labels, page_count=page_count)


@router.post("/{sid}/labels", response_model=PageLabelsResponse)
async def set_page_labels(
    sid: str,
    request: PageLabelsRequest,
    sm: SessionManager = Depends(get_session_manager),
):
    """Set page labels on the PDF (e.g., roman numerals, custom labels)."""
    pdf_bytes = sm.get_current_pdf_bytes(sid)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="Session not found")

    doc = PdfEngine.open_from_bytes(pdf_bytes)
    try:
        # Build page label rules from the provided labels
        # PyMuPDF uses set_page_labels with a list of rules
        rules: list[dict] = []
        for entry in request.labels:
            page_idx = entry.page - 1
            if 0 <= page_idx < doc.page_count:
                rules.append({
                    "startpage": page_idx,
                    "prefix": entry.label,
                    "style": "",  # No auto-numbering, use prefix as-is
                    "firstpagenum": 1,
                })

        if rules:
            doc.set_page_labels(rules)

        new_bytes = PdfEngine.save_to_bytes(doc)
        page_count = doc.page_count
    finally:
        doc.close()

    sm.save_current_pdf(sid, new_bytes, "set page labels")

    return PageLabelsResponse(page_count=page_count)

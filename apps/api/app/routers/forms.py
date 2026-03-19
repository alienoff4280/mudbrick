"""
Mudbrick v2 -- Forms Router

PDF form field detection, filling, flattening, and data import/export.
"""

from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..dependencies import get_session_manager
from ..services.pdf_engine import PdfEngine
from ..services.session_manager import SessionManager

router = APIRouter(prefix="/api/forms", tags=["forms"])


class FormField(BaseModel):
    name: str
    type: str  # text, checkbox, radio, dropdown, signature, button
    page: int  # 1-indexed
    rect: list[float]  # [x, y, width, height]
    value: Any = None
    options: list[str] = Field(default_factory=list)
    flags: int = 0
    read_only: bool = False


class FormFieldsResponse(BaseModel):
    fields: list[FormField]
    total: int
    has_xfa: bool = False


class FormFillRequest(BaseModel):
    fields: dict[str, Any]  # { field_name: value }


class FormFillResponse(BaseModel):
    success: bool = True
    fields_updated: int
    page_count: int


class FormFlattenResponse(BaseModel):
    success: bool = True
    page_count: int


class FormExportResponse(BaseModel):
    success: bool = True
    format: str
    data: dict[str, Any]


class FormImportRequest(BaseModel):
    format: str = "json"  # json, xfdf
    data: dict[str, Any]


class FormImportResponse(BaseModel):
    success: bool = True
    fields_updated: int


# Widget type mapping for PyMuPDF field types
FIELD_TYPE_MAP = {
    0: "button",     # PDF_WIDGET_TYPE_BUTTON
    1: "button",     # push button
    2: "checkbox",   # PDF_WIDGET_TYPE_CHECKBOX
    3: "radio",      # PDF_WIDGET_TYPE_RADIOBUTTON
    4: "text",       # PDF_WIDGET_TYPE_TEXT
    5: "dropdown",   # PDF_WIDGET_TYPE_LISTBOX
    6: "dropdown",   # PDF_WIDGET_TYPE_COMBOBOX
    7: "signature",  # PDF_WIDGET_TYPE_SIGNATURE
}


def _extract_fields(doc) -> list[FormField]:
    """Extract all form fields from a PyMuPDF document."""
    fields: list[FormField] = []

    for page_idx in range(doc.page_count):
        page = doc[page_idx]
        for widget in page.widgets():
            field_type = FIELD_TYPE_MAP.get(widget.field_type, "text")
            rect = widget.rect
            field = FormField(
                name=widget.field_name or f"field_{page_idx}_{len(fields)}",
                type=field_type,
                page=page_idx + 1,
                rect=[rect.x0, rect.y0, rect.width, rect.height],
                value=widget.field_value,
                options=list(widget.choice_values) if hasattr(widget, "choice_values") and widget.choice_values else [],
                flags=widget.field_flags or 0,
                read_only=bool(widget.field_flags and widget.field_flags & 1),
            )
            fields.append(field)

    return fields


@router.get("/{sid}/fields", response_model=FormFieldsResponse)
async def get_form_fields(
    sid: str,
    sm: SessionManager = Depends(get_session_manager),
):
    """Detect and return all form fields in the PDF."""
    pdf_bytes = sm.get_current_pdf_bytes(sid)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="Session not found")

    doc = PdfEngine.open_from_bytes(pdf_bytes)
    try:
        fields = _extract_fields(doc)
        has_xfa = doc.is_form_pdf and hasattr(doc, "xfa") and bool(doc.xfa)
    finally:
        doc.close()

    return FormFieldsResponse(
        fields=fields,
        total=len(fields),
        has_xfa=has_xfa,
    )


@router.post("/{sid}/fill", response_model=FormFillResponse)
async def fill_form_fields(
    sid: str,
    request: FormFillRequest,
    sm: SessionManager = Depends(get_session_manager),
):
    """Fill form fields with provided values."""
    pdf_bytes = sm.get_current_pdf_bytes(sid)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="Session not found")

    doc = PdfEngine.open_from_bytes(pdf_bytes)
    try:
        fields_updated = 0
        for page_idx in range(doc.page_count):
            page = doc[page_idx]
            for widget in page.widgets():
                field_name = widget.field_name
                if field_name and field_name in request.fields:
                    value = request.fields[field_name]

                    if widget.field_type in (2, 3):  # checkbox / radio
                        widget.field_value = "Yes" if value else "Off"
                    else:
                        widget.field_value = str(value) if value is not None else ""

                    widget.update()
                    fields_updated += 1

        new_bytes = PdfEngine.save_to_bytes(doc)
        page_count = doc.page_count
    finally:
        doc.close()

    sm.save_current_pdf(sid, new_bytes, f"fill {fields_updated} form field(s)")

    return FormFillResponse(
        fields_updated=fields_updated,
        page_count=page_count,
    )


@router.post("/{sid}/flatten", response_model=FormFlattenResponse)
async def flatten_form(
    sid: str,
    sm: SessionManager = Depends(get_session_manager),
):
    """Flatten form fields into static content (makes fields non-editable)."""
    pdf_bytes = sm.get_current_pdf_bytes(sid)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="Session not found")

    doc = PdfEngine.open_from_bytes(pdf_bytes)
    try:
        # Reset form fields so their appearance is rendered as static content
        for page_idx in range(doc.page_count):
            page = doc[page_idx]
            # Iterate over a copy since we'll be deleting widgets
            widgets = list(page.widgets())
            for widget in widgets:
                # Generate the appearance stream, then delete the widget
                widget.update()

            # Remove all widget annotations to flatten
            page.clean_contents()

        # Use need_appearances to ensure values are rendered
        # Then remove the AcroForm to flatten
        if hasattr(doc, "_reset_acroform"):
            doc._reset_acroform()

        new_bytes = PdfEngine.save_to_bytes(doc)
        page_count = doc.page_count
    finally:
        doc.close()

    sm.save_current_pdf(sid, new_bytes, "flatten form fields")

    return FormFlattenResponse(page_count=page_count)


@router.get("/{sid}/export")
async def export_form_data(
    sid: str,
    format: str = Query(default="json", regex="^(json)$"),
    sm: SessionManager = Depends(get_session_manager),
):
    """Export form field data as JSON."""
    pdf_bytes = sm.get_current_pdf_bytes(sid)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="Session not found")

    doc = PdfEngine.open_from_bytes(pdf_bytes)
    try:
        fields = _extract_fields(doc)
    finally:
        doc.close()

    data: dict[str, Any] = {}
    for field in fields:
        data[field.name] = field.value

    return FormExportResponse(
        format=format,
        data=data,
    )


@router.post("/{sid}/import", response_model=FormImportResponse)
async def import_form_data(
    sid: str,
    request: FormImportRequest,
    sm: SessionManager = Depends(get_session_manager),
):
    """Import form field data from JSON."""
    pdf_bytes = sm.get_current_pdf_bytes(sid)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if request.format != "json":
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format: {request.format}. Only 'json' is currently supported.",
        )

    doc = PdfEngine.open_from_bytes(pdf_bytes)
    try:
        fields_updated = 0
        for page_idx in range(doc.page_count):
            page = doc[page_idx]
            for widget in page.widgets():
                field_name = widget.field_name
                if field_name and field_name in request.data:
                    value = request.data[field_name]
                    if widget.field_type in (2, 3):
                        widget.field_value = "Yes" if value else "Off"
                    else:
                        widget.field_value = str(value) if value is not None else ""
                    widget.update()
                    fields_updated += 1

        new_bytes = PdfEngine.save_to_bytes(doc)
    finally:
        doc.close()

    sm.save_current_pdf(sid, new_bytes, f"import {fields_updated} form field(s)")

    return FormImportResponse(fields_updated=fields_updated)

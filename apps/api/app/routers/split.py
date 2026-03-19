"""
Mudbrick v2 -- Split Router

POST /api/split/{sid} -- Split PDF by page ranges into separate files.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..dependencies import get_session_manager
from ..services.pdf_engine import PdfEngine
from ..services.session_manager import SessionManager

router = APIRouter(prefix="/api/split", tags=["split"])


# ── Models ──


class SplitRequest(BaseModel):
    """Request to split a PDF into multiple files."""

    ranges: list[str] = Field(
        ...,
        description='Page ranges: ["1-3", "4-6", "7-10"]',
        min_length=1,
    )
    output_dir: str = Field(
        ...,
        description="Local directory to write split PDF files",
    )
    filename_prefix: Optional[str] = Field(
        None,
        description="Prefix for output filenames. Defaults to original filename.",
    )


class SplitPart(BaseModel):
    """Information about a single split part."""

    file_path: str
    pages: str  # e.g., "1-3"
    page_count: int
    file_size: int


class SplitResponse(BaseModel):
    """Response from splitting a PDF."""

    success: bool
    parts: list[SplitPart]
    total_parts: int


# ── Helpers ──


def _parse_range(range_str: str, max_page: int) -> list[int]:
    """Parse a range string like '1-3' or '5' into a list of 1-indexed page numbers."""
    pages: list[int] = []
    range_str = range_str.strip()

    if "-" in range_str:
        try:
            start, end = range_str.split("-", 1)
            start_num = int(start.strip())
            end_num = int(end.strip())
            for p in range(start_num, end_num + 1):
                if 1 <= p <= max_page:
                    pages.append(p)
        except ValueError:
            pass
    else:
        try:
            p = int(range_str)
            if 1 <= p <= max_page:
                pages.append(p)
        except ValueError:
            pass

    return pages


# ── Endpoint ──


@router.post("/{sid}", response_model=SplitResponse)
async def split_pdf(
    sid: str,
    request: SplitRequest,
    sm: SessionManager = Depends(get_session_manager),
):
    """Split a PDF into multiple files by page ranges.

    Each range produces a separate PDF file in the output directory.
    """
    session = sm.get_session(sid)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {sid}")

    pdf_path = sm.get_current_pdf_path(sid)
    if pdf_path is None:
        raise HTTPException(status_code=404, detail="No PDF found for session")

    # Validate and create output directory
    output_dir = Path(request.output_dir)
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot create output directory: {e}",
        )

    doc = PdfEngine.open_from_file(str(pdf_path))
    try:
        total_pages = doc.page_count

        # Validate ranges
        if not request.ranges:
            raise HTTPException(
                status_code=400, detail="At least one page range is required"
            )

        # Determine filename prefix
        prefix = request.filename_prefix
        if not prefix:
            original_name = session.file_name or "document"
            # Remove .pdf extension
            if original_name.lower().endswith(".pdf"):
                prefix = original_name[:-4]
            else:
                prefix = original_name

        parts: list[SplitPart] = []

        for i, range_str in enumerate(request.ranges):
            page_nums = _parse_range(range_str, total_pages)
            if not page_nums:
                continue

            # Create a new PDF with just these pages
            split_doc = fitz.open()
            for page_num in page_nums:
                split_doc.insert_pdf(
                    doc,
                    from_page=page_num - 1,
                    to_page=page_num - 1,
                )

            # Write the split PDF
            part_num = i + 1
            filename = f"{prefix}_part{part_num}.pdf"
            file_path = output_dir / filename
            split_doc.save(str(file_path))
            file_size = file_path.stat().st_size
            split_doc.close()

            parts.append(
                SplitPart(
                    file_path=str(file_path),
                    pages=range_str.strip(),
                    page_count=len(page_nums),
                    file_size=file_size,
                )
            )

        if not parts:
            raise HTTPException(
                status_code=400,
                detail="No valid page ranges specified",
            )

        return SplitResponse(
            success=True,
            parts=parts,
            total_parts=len(parts),
        )
    finally:
        doc.close()

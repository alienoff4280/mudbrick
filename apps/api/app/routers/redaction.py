"""
Mudbrick v2 -- Redaction Router

POST /api/redaction/{sid}/search  -- find pattern matches
POST /api/redaction/{sid}/apply   -- apply forensic redaction
GET  /api/redaction/patterns      -- list available patterns
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..dependencies import get_session_manager
from ..models.redaction import (
    RedactionApplyRequest,
    RedactionMatch,
    RedactionRect,
    RedactionResult,
    RedactionSearchRequest,
    RedactionSearchResponse,
)
from ..services.pdf_engine import PdfEngine
from ..services.redaction_engine import (
    apply_redactions,
    get_available_patterns,
    search_patterns,
)
from ..services.session_manager import SessionManager

router = APIRouter(prefix="/api/redaction", tags=["redaction"])


@router.get("/patterns")
async def list_patterns() -> list[dict[str, str]]:
    """List available built-in redaction patterns."""
    return get_available_patterns()


@router.post("/{sid}/search", response_model=RedactionSearchResponse)
async def search_redaction_patterns(
    sid: str,
    request: RedactionSearchRequest,
    sm: SessionManager = Depends(get_session_manager),
):
    """Search for sensitive data patterns in the document.

    Returns matches with page numbers, matched text, and bounding rectangles.
    """
    session = sm.get_session(sid)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {sid}")

    pdf_path = sm.get_current_pdf_path(sid)
    if pdf_path is None:
        raise HTTPException(status_code=404, detail="No PDF found for session")

    doc = PdfEngine.open_from_file(str(pdf_path))
    try:
        results = search_patterns(
            doc,
            pattern_names=request.patterns,
            custom_regex=request.custom_regex,
            pages=request.pages,
        )

        matches = [
            RedactionMatch(
                id=r.id,
                page=r.page,
                pattern=r.pattern,
                text=r.text,
                rects=[
                    RedactionRect(
                        x=rect["x"],
                        y=rect["y"],
                        width=rect["width"],
                        height=rect["height"],
                    )
                    for rect in r.rects
                ],
            )
            for r in results
        ]

        # Count unique pages searched
        if request.pages:
            pages_searched = len(
                [p for p in request.pages if 1 <= p <= doc.page_count]
            )
        else:
            pages_searched = doc.page_count

        return RedactionSearchResponse(
            matches=matches,
            total=len(matches),
            pages_searched=pages_searched,
        )
    finally:
        doc.close()


@router.post("/{sid}/apply", response_model=RedactionResult)
async def apply_redaction(
    sid: str,
    request: RedactionApplyRequest,
    sm: SessionManager = Depends(get_session_manager),
):
    """Apply forensic redaction to specified regions.

    This PERMANENTLY removes content from the PDF -- text, images, and vector
    content under the redaction rectangles are stripped from the PDF objects.
    This is NOT just a visual cover -- it is forensic redaction.
    """
    session = sm.get_session(sid)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {sid}")

    pdf_path = sm.get_current_pdf_path(sid)
    if pdf_path is None:
        raise HTTPException(status_code=404, detail="No PDF found for session")

    doc = PdfEngine.open_from_file(str(pdf_path))
    try:
        regions = [
            {
                "page": region.page,
                "rects": [
                    {
                        "x": r.x,
                        "y": r.y,
                        "width": r.width,
                        "height": r.height,
                    }
                    for r in region.rects
                ],
            }
            for region in request.regions
        ]

        total_redacted = apply_redactions(doc, regions)

        if total_redacted == 0:
            raise HTTPException(
                status_code=400, detail="No valid regions to redact"
            )

        # Save the redacted PDF
        pdf_bytes = doc.tobytes()
        new_version = sm.save_current_pdf(sid, pdf_bytes, "redaction")

        # Count unique pages
        pages_redacted = len(set(r["page"] for r in regions))

        return RedactionResult(
            success=True,
            pages_redacted=pages_redacted,
            regions_redacted=total_redacted,
            new_version=new_version,
        )
    finally:
        doc.close()

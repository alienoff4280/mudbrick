"""
Mudbrick v2 -- OCR Router

POST /api/ocr/{sid}         -- Start OCR with SSE streaming progress
GET  /api/ocr/{sid}/results -- Get cached OCR results
"""

from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from ..dependencies import get_session_manager
from ..services.ocr_engine import (
    OcrDocumentResult,
    load_ocr_results,
    ocr_page,
    save_ocr_results,
)
from ..services.pdf_engine import PdfEngine
from ..services.session_manager import SessionManager
from ..utils.streaming import sse_done, sse_error, sse_event, sse_progress

router = APIRouter(prefix="/api/ocr", tags=["ocr"])


class OcrRequest(BaseModel):
    """Request to start OCR processing."""

    pages: Optional[list[int]] = Field(
        None,
        description="Specific pages to OCR (1-indexed). None = all pages.",
    )
    language: str = Field(
        "eng",
        description="Tesseract language code (e.g., 'eng', 'spa', 'fra').",
    )
    dpi: int = Field(
        300,
        description="DPI for page rendering. Higher = better accuracy, slower.",
        ge=72,
        le=600,
    )


@router.post("/{sid}")
async def start_ocr(
    sid: str,
    request: OcrRequest,
    sm: SessionManager = Depends(get_session_manager),
) -> EventSourceResponse:
    """Start OCR processing with SSE streaming progress.

    Returns an SSE stream with events:
    - page_complete: { page, total, words, confidence }
    - done: { status: "complete", total_words, avg_confidence }
    - error: { message }
    """
    session = sm.get_session(sid)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {sid}")

    pdf_path = sm.get_current_pdf_path(sid)
    if pdf_path is None:
        raise HTTPException(status_code=404, detail="No PDF found for session")

    async def ocr_stream():
        doc = None
        try:
            doc = PdfEngine.open_from_file(str(pdf_path))

            # Determine which pages to OCR
            if request.pages:
                page_indices = [
                    p - 1
                    for p in request.pages
                    if 1 <= p <= doc.page_count
                ]
            else:
                page_indices = list(range(doc.page_count))

            total_pages = len(page_indices)
            all_page_results = []
            total_words = 0
            total_conf = 0.0
            conf_count = 0

            for i, page_idx in enumerate(page_indices):
                page = doc[page_idx]
                page_num = page_idx + 1

                try:
                    # Run OCR on this page (blocking -- run in thread)
                    result = await asyncio.to_thread(
                        ocr_page,
                        page,
                        page_num,
                        language=request.language,
                        dpi=request.dpi,
                    )

                    all_page_results.append(result)
                    total_words += result.word_count
                    if result.avg_confidence > 0:
                        total_conf += result.avg_confidence
                        conf_count += 1

                    # Send progress event
                    yield sse_progress(
                        page=page_num,
                        total=total_pages,
                        words=result.word_count,
                        confidence=result.avg_confidence,
                    )

                except Exception as e:
                    yield sse_error(
                        f"OCR failed on page {page_num}: {str(e)}"
                    )
                    continue

            # Build full result and cache it
            avg_conf = round(total_conf / conf_count, 3) if conf_count > 0 else 0.0
            doc_result = OcrDocumentResult(
                pages=all_page_results,
                total_words=total_words,
                avg_confidence=avg_conf,
                language=request.language,
            )

            # Save results to session directory
            session_dir = sm._session_dir(sid)
            save_ocr_results(session_dir, doc_result)

            # Send completion event
            yield sse_done(
                total_words=total_words,
                avg_confidence=avg_conf,
                pages_processed=len(all_page_results),
            )

        except Exception as e:
            yield sse_error(f"OCR processing failed: {str(e)}")
        finally:
            if doc:
                doc.close()

    return EventSourceResponse(ocr_stream())


@router.get("/{sid}/results")
async def get_ocr_results(
    sid: str,
    sm: SessionManager = Depends(get_session_manager),
) -> dict:
    """Get cached OCR results for a session.

    Returns the full OCR results if available, or 404 if OCR has not been run.
    """
    session = sm.get_session(sid)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {sid}")

    session_dir = sm._session_dir(sid)
    result = load_ocr_results(session_dir)

    if result is None:
        raise HTTPException(
            status_code=404,
            detail="No OCR results found. Run OCR first.",
        )

    return result.to_dict()

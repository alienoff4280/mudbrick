"""
Mudbrick v2 -- Document Upload/Download Router

Handles file upload (single + chunked), download, session management.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response, RedirectResponse

from ..dependencies import get_session, get_session_manager
from ..models.document import (
    ChunkCompleteRequest,
    ChunkUploadResponse,
    SessionCreateResponse,
    SessionInfoResponse,
    UndoRedoResponse,
    VersionInfo,
)
from ..services.pdf_engine import PdfEngine
from ..services.session_manager import SessionManager
from ..utils.file_handling import is_valid_pdf

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.post("/upload", response_model=SessionCreateResponse)
async def upload_document(
    file: UploadFile = File(...),
    sm: SessionManager = Depends(get_session_manager),
):
    """Upload a PDF document and create a new editing session.

    For files > 10MB, use the chunked upload endpoints instead.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    if not is_valid_pdf(data):
        raise HTTPException(status_code=400, detail="Invalid PDF file")

    # Validate with PyMuPDF and get page count
    try:
        doc = PdfEngine.open_from_bytes(data)
        page_count = doc.page_count
        doc.close()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot open PDF: {str(e)}")

    meta = await sm.create_session(data, file.filename or "document.pdf")
    meta = await sm.update_metadata(meta.session_id, page_count=page_count)

    return SessionCreateResponse(
        session_id=meta.session_id,
        page_count=page_count,
        file_size=meta.file_size,
    )


@router.post("/upload/chunk", response_model=ChunkUploadResponse)
async def upload_chunk(
    chunk: UploadFile = File(...),
    session_id: str = Form(...),
    chunk_index: int = Form(...),
    sm: SessionManager = Depends(get_session_manager),
):
    """Upload a single chunk of a large file.

    Chunks are stored in Blob under sessions/{sid}/chunks/chunk_{index}.
    """
    data = await chunk.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty chunk")

    blob = sm.blob
    chunk_key = f"sessions/{session_id}/chunks/chunk_{chunk_index}"
    await blob.put(chunk_key, data)

    return ChunkUploadResponse(chunk_index=chunk_index, received=True)


@router.post("/upload/complete", response_model=SessionCreateResponse)
async def complete_chunked_upload(
    request: ChunkCompleteRequest,
    sm: SessionManager = Depends(get_session_manager),
):
    """Assemble uploaded chunks into a single PDF and create a session."""
    blob = sm.blob

    # Assemble chunks
    assembled = bytearray()
    for i in range(request.chunk_count):
        chunk_key = f"sessions/{request.session_id}/chunks/chunk_{i}"
        chunk_data = await blob.get(chunk_key)
        if chunk_data is None:
            raise HTTPException(
                status_code=400,
                detail=f"Missing chunk {i}. Upload all chunks before completing.",
            )
        assembled.extend(chunk_data)

    pdf_bytes = bytes(assembled)

    if not is_valid_pdf(pdf_bytes):
        raise HTTPException(status_code=400, detail="Assembled file is not a valid PDF")

    # Validate and get page count
    try:
        doc = PdfEngine.open_from_bytes(pdf_bytes)
        page_count = doc.page_count
        doc.close()
    except Exception as e:
        raise HTTPException(
            status_code=400, detail=f"Cannot open assembled PDF: {str(e)}"
        )

    # Create session with assembled PDF
    meta = await sm.create_session(pdf_bytes, request.file_name)
    meta = await sm.update_metadata(meta.session_id, page_count=page_count)

    # Clean up chunks
    for i in range(request.chunk_count):
        chunk_key = f"sessions/{request.session_id}/chunks/chunk_{i}"
        await blob.delete(chunk_key)

    return SessionCreateResponse(
        session_id=meta.session_id,
        page_count=page_count,
        file_size=meta.file_size,
    )


@router.get("/{sid}", response_model=SessionInfoResponse)
async def get_document_info(
    sid: str,
    sm: SessionManager = Depends(get_session_manager),
):
    """Get session metadata and version history."""
    meta = await sm.get_session(sid)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {sid}")

    versions = await sm.get_versions(sid)

    return SessionInfoResponse(
        session_id=meta.session_id,
        file_name=meta.file_name,
        file_size=meta.file_size,
        page_count=meta.page_count,
        current_version=meta.current_version,
        versions=versions,
        created_at=meta.created_at,
        updated_at=meta.updated_at,
    )


@router.get("/{sid}/download")
async def download_document(
    sid: str,
    sm: SessionManager = Depends(get_session_manager),
):
    """Download the current version of the document.

    In production, this would return a presigned Blob URL (redirect).
    In local dev, it returns the PDF bytes directly.
    """
    meta = await sm.get_session(sid)
    if meta is None:
        raise HTTPException(status_code=404, detail=f"Session not found: {sid}")

    pdf_bytes = await sm.get_current_pdf(sid)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="PDF file not found")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{meta.file_name}"',
        },
    )


@router.delete("/{sid}")
async def delete_document(
    sid: str,
    sm: SessionManager = Depends(get_session_manager),
):
    """Delete a session and all its data."""
    deleted = await sm.delete_session(sid)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Session not found: {sid}")
    return {"deleted": True}


@router.post("/{sid}/undo", response_model=UndoRedoResponse)
async def undo_operation(
    sid: str,
    sm: SessionManager = Depends(get_session_manager),
):
    """Undo the last document operation."""
    result = await sm.undo(sid)
    if result is None:
        raise HTTPException(status_code=400, detail="Nothing to undo")
    return result


@router.post("/{sid}/redo", response_model=UndoRedoResponse)
async def redo_operation(
    sid: str,
    sm: SessionManager = Depends(get_session_manager),
):
    """Redo the last undone operation."""
    result = await sm.redo(sid)
    if result is None:
        raise HTTPException(status_code=400, detail="Nothing to redo")
    return result

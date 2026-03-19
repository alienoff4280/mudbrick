"""
Mudbrick v2 -- FastAPI Application (Desktop Sidecar)

Local backend running on localhost:8000 as a Tauri sidecar process.
All file operations are local filesystem -- nothing leaves the machine.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .dependencies import get_session_manager
from .routers import (
    bates,
    documents,
    export,
    headers,
    merge,
    ocr,
    pages,
    redaction,
    split,
    text,
    thumbnails,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle for the backend sidecar."""
    # Startup: clean up stale sessions from crashes
    sm = get_session_manager()
    deleted = sm.cleanup_stale_sessions()
    if deleted > 0:
        print(f"Cleaned up {deleted} stale session(s)")
    yield
    # Shutdown: nothing to do (sessions persist for crash recovery)


app = FastAPI(
    title="Mudbrick API",
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url=None,
    lifespan=lifespan,
)

# CORS -- needed for local dev (Vite on :5173 -> uvicorn on :8000)
# and Tauri WebView (tauri://localhost -> localhost:8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "tauri://localhost",
        "https://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(documents.router)
app.include_router(pages.router)
app.include_router(merge.router)
app.include_router(thumbnails.router)
app.include_router(export.router)
app.include_router(bates.router)
app.include_router(headers.router)
app.include_router(redaction.router)
app.include_router(ocr.router)
app.include_router(text.router)
app.include_router(split.router)


@app.get("/api/health")
async def health_check() -> dict:
    """Health check endpoint used by Tauri to verify sidecar is ready."""
    return {
        "status": "ok",
        "version": "2.0.0",
    }

"""
Mudbrick v2 -- FastAPI Application
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings

app = FastAPI(
    title="Mudbrick API",
    version="2.0.0",
    docs_url="/api/docs" if settings.environment == "local" else None,
    redoc_url=None,
)

# CORS -- only needed for local dev (Vite on :5173 -> uvicorn on :8000)
# In production, frontend and API share the same Vercel domain (no CORS needed).
if settings.environment == "local":
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.get("/api/health")
async def health_check() -> dict:
    """Health check endpoint."""
    return {
        "status": "ok",
        "version": "2.0.0",
        "environment": settings.environment,
    }

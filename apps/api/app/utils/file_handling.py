"""
Mudbrick v2 -- File Handling Utilities

Temp file management, PDF validation, and helper functions.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Optional


def get_temp_dir(session_id: Optional[str] = None) -> Path:
    """Get a temporary directory for processing, optionally scoped to a session."""
    base = Path(tempfile.gettempdir()) / "mudbrick"
    if session_id:
        base = base / session_id
    base.mkdir(parents=True, exist_ok=True)
    return base


def cleanup_temp_dir(session_id: str) -> None:
    """Remove temporary files for a session."""
    import shutil

    temp_dir = get_temp_dir(session_id)
    if temp_dir.exists():
        shutil.rmtree(temp_dir, ignore_errors=True)


def is_valid_pdf(data: bytes) -> bool:
    """Quick check if bytes look like a valid PDF (magic bytes check)."""
    return data[:5] == b"%PDF-"


def format_file_size(size_bytes: int) -> str:
    """Format a file size in bytes to a human-readable string."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    else:
        return f"{size_bytes / (1024 * 1024 * 1024):.1f} GB"

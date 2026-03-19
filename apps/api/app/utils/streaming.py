"""
Mudbrick v2 -- SSE Streaming Utilities

Helper functions for Server-Sent Events (SSE) streaming via sse-starlette.
"""

from __future__ import annotations

import json
from typing import Any, AsyncGenerator

from sse_starlette.sse import EventSourceResponse


def sse_response(generator: AsyncGenerator) -> EventSourceResponse:
    """Create an SSE EventSourceResponse from an async generator.

    The generator should yield dicts with "event" and "data" keys.
    """
    return EventSourceResponse(generator)


def sse_event(event: str, data: Any) -> dict:
    """Create a properly formatted SSE event dict.

    Args:
        event: The event type name (e.g., "page_complete", "done", "error").
        data: The event data (will be JSON-serialized).

    Returns:
        Dict with "event" and "data" keys for sse-starlette.
    """
    return {
        "event": event,
        "data": json.dumps(data) if not isinstance(data, str) else data,
    }


def sse_progress(page: int, total: int, **extra: Any) -> dict:
    """Create a progress SSE event for page-based operations.

    Args:
        page: Current page number (1-indexed).
        total: Total number of pages.
        **extra: Additional data fields.

    Returns:
        SSE event dict.
    """
    data = {"page": page, "total": total, **extra}
    return sse_event("page_complete", data)


def sse_done(**extra: Any) -> dict:
    """Create a completion SSE event.

    Args:
        **extra: Additional data fields for the done event.

    Returns:
        SSE event dict.
    """
    data = {"status": "complete", **extra}
    return sse_event("done", data)


def sse_error(message: str) -> dict:
    """Create an error SSE event.

    Args:
        message: Error description.

    Returns:
        SSE event dict.
    """
    return sse_event("error", {"message": message})

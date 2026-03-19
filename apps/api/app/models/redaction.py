"""
Mudbrick v2 -- Redaction Pydantic Models

Request/response models for forensic redaction endpoints.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class RedactionRect(BaseModel):
    """A bounding rectangle in PDF coordinates (points, origin bottom-left)."""

    x: float
    y: float
    width: float
    height: float


class RedactionSearchRequest(BaseModel):
    """Request to search for sensitive data patterns in a PDF."""

    patterns: list[str] = Field(
        ...,
        description="Pattern names to search: ssn, credit_card, email, phone, date, custom",
    )
    custom_regex: Optional[str] = Field(
        None,
        description="Custom regex string when 'custom' is in patterns",
    )
    pages: Optional[list[int]] = Field(
        None,
        description="Specific pages to search (1-indexed). None = all pages.",
    )


class RedactionMatch(BaseModel):
    """A single match found by pattern search."""

    id: str = Field(..., description="Unique match identifier")
    page: int = Field(..., description="Page number (1-indexed)")
    pattern: str = Field(..., description="Pattern name that matched")
    text: str = Field(..., description="Matched text content")
    rects: list[RedactionRect] = Field(
        ..., description="Bounding rectangles in PDF coordinates"
    )


class RedactionSearchResponse(BaseModel):
    """Response from a pattern search."""

    matches: list[RedactionMatch]
    total: int
    pages_searched: int


class RedactionRegion(BaseModel):
    """A region to redact on a specific page."""

    page: int = Field(..., description="Page number (1-indexed)")
    rects: list[RedactionRect] = Field(
        ..., description="Bounding rectangles to redact"
    )


class RedactionApplyRequest(BaseModel):
    """Request to apply forensic redaction to specific regions."""

    regions: list[RedactionRegion]


class RedactionResult(BaseModel):
    """Response from applying redaction."""

    success: bool
    pages_redacted: int
    regions_redacted: int
    new_version: int

"""
Mudbrick v2 -- Forensic Redaction Engine

PyMuPDF-based forensic redaction: search text by regex, find regions,
apply redaction annotations that strip underlying PDF objects.

Patterns ported from v1 js/redact-patterns.js.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from typing import Optional

import fitz  # PyMuPDF


# ── Built-in Patterns (ported from v1 js/redact-patterns.js) ──


@dataclass
class PatternDef:
    """Definition of a redaction search pattern."""

    name: str
    label: str
    description: str
    regex: re.Pattern[str]
    validate: Optional[callable] = None


def _validate_ssn(match_text: str) -> bool:
    """Validate SSN: cannot start with 000, 666, or 9xx; group/serial != 0."""
    digits = re.sub(r"[-\s]", "", match_text)
    if len(digits) != 9:
        return False
    area = int(digits[:3])
    if area == 0 or area == 666 or area >= 900:
        return False
    if digits[3:5] == "00":
        return False
    if digits[5:] == "0000":
        return False
    return True


def _validate_credit_card(match_text: str) -> bool:
    """Validate credit card via Luhn check."""
    digits = re.sub(r"[-\s]", "", match_text)
    if len(digits) < 13 or len(digits) > 19:
        return False
    return _luhn_check(digits)


def _luhn_check(num: str) -> bool:
    """Luhn algorithm for credit card validation."""
    total = 0
    alt = False
    for i in range(len(num) - 1, -1, -1):
        n = int(num[i])
        if alt:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        alt = not alt
    return total % 10 == 0


def _validate_phone(match_text: str) -> bool:
    """Validate US phone number: 10-11 digits."""
    digits = re.sub(r"\D", "", match_text)
    return 10 <= len(digits) <= 11


BUILTIN_PATTERNS: dict[str, PatternDef] = {
    "ssn": PatternDef(
        name="ssn",
        label="Social Security Numbers",
        description="XXX-XX-XXXX format",
        regex=re.compile(r"\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b"),
        validate=_validate_ssn,
    ),
    "credit_card": PatternDef(
        name="credit_card",
        label="Credit Card Numbers",
        description="Visa, Mastercard, Amex, Discover",
        regex=re.compile(r"\b(?:\d{4}[-\s]?){3}\d{1,4}\b"),
        validate=_validate_credit_card,
    ),
    "email": PatternDef(
        name="email",
        label="Email Addresses",
        description="user@domain.com",
        regex=re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"),
    ),
    "phone": PatternDef(
        name="phone",
        label="Phone Numbers",
        description="US formats: (555) 123-4567, 555-123-4567, +1 555 123 4567",
        regex=re.compile(r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"),
        validate=_validate_phone,
    ),
    "date": PatternDef(
        name="date",
        label="Dates",
        description="MM/DD/YYYY, MM-DD-YYYY, Month DD, YYYY",
        regex=re.compile(
            r"\b(?:\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}"
            r"|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b",
            re.IGNORECASE,
        ),
    ),
}


def get_available_patterns() -> list[dict[str, str]]:
    """Return list of available built-in pattern names and descriptions."""
    return [
        {"name": p.name, "label": p.label, "description": p.description}
        for p in BUILTIN_PATTERNS.values()
    ]


# ── Search ──


@dataclass
class MatchResult:
    """A text match with its location on a page."""

    id: str
    page: int  # 1-indexed
    pattern: str
    text: str
    rects: list[dict]  # [{"x": float, "y": float, "width": float, "height": float}]


def search_patterns(
    doc: fitz.Document,
    pattern_names: list[str],
    custom_regex: Optional[str] = None,
    pages: Optional[list[int]] = None,
) -> list[MatchResult]:
    """Search for sensitive data patterns across PDF pages.

    Args:
        doc: Open PyMuPDF document.
        pattern_names: List of pattern names (from BUILTIN_PATTERNS keys, or "custom").
        custom_regex: Custom regex string when "custom" is in pattern_names.
        pages: Specific 1-indexed page numbers to search. None = all pages.

    Returns:
        List of MatchResult with page numbers and bounding rectangles.
    """
    results: list[MatchResult] = []

    # Determine which pages to search
    if pages:
        page_nums = [p - 1 for p in pages if 1 <= p <= doc.page_count]
    else:
        page_nums = list(range(doc.page_count))

    for page_idx in page_nums:
        page = doc[page_idx]
        page_num = page_idx + 1  # 1-indexed for output

        for pattern_name in pattern_names:
            if pattern_name == "custom":
                if not custom_regex:
                    continue
                try:
                    regex = re.compile(custom_regex, re.IGNORECASE)
                except re.error:
                    # Invalid regex -- escape and treat as literal
                    regex = re.compile(re.escape(custom_regex), re.IGNORECASE)
                validate_fn = None
            else:
                pattern_def = BUILTIN_PATTERNS.get(pattern_name)
                if pattern_def is None:
                    continue
                regex = pattern_def.regex
                validate_fn = pattern_def.validate

            # Use PyMuPDF's text search for each match in page text
            page_text = page.get_text("text")

            for match in regex.finditer(page_text):
                match_text = match.group()

                # Validate if pattern has a validator
                if validate_fn and not validate_fn(match_text):
                    continue

                # Find bounding rectangles using PyMuPDF's search
                # search_for returns list of fitz.Rect
                quads = page.search_for(match_text)
                if not quads:
                    continue

                rects = []
                for rect in quads:
                    rects.append(
                        {
                            "x": float(rect.x0),
                            "y": float(rect.y0),
                            "width": float(rect.width),
                            "height": float(rect.height),
                        }
                    )

                results.append(
                    MatchResult(
                        id=uuid.uuid4().hex[:12],
                        page=page_num,
                        pattern=pattern_name,
                        text=match_text,
                        rects=rects,
                    )
                )

    return results


# ── Apply Forensic Redaction ──


def apply_redactions(
    doc: fitz.Document,
    regions: list[dict],
) -> int:
    """Apply forensic redaction to specified regions.

    This performs REAL forensic redaction using PyMuPDF:
    1. Adds redaction annotations at the specified rectangles
    2. Applies redactions which STRIPS underlying PDF objects (text, images, vectors)
    3. The redacted content is permanently removed from the PDF

    Args:
        doc: Open PyMuPDF document (will be modified in-place).
        regions: List of dicts with "page" (1-indexed) and "rects" (list of rect dicts).

    Returns:
        Number of regions redacted.
    """
    total_redacted = 0

    # Group regions by page for efficiency
    pages_to_redact: dict[int, list[dict]] = {}
    for region in regions:
        page_num = region["page"]
        page_idx = page_num - 1
        if page_idx < 0 or page_idx >= doc.page_count:
            continue
        if page_idx not in pages_to_redact:
            pages_to_redact[page_idx] = []
        pages_to_redact[page_idx].extend(region["rects"])

    for page_idx, rects in pages_to_redact.items():
        page = doc[page_idx]

        for rect_data in rects:
            rect = fitz.Rect(
                rect_data["x"],
                rect_data["y"],
                rect_data["x"] + rect_data["width"],
                rect_data["y"] + rect_data["height"],
            )
            # Add redaction annotation -- black fill, no text
            page.add_redact_annot(rect, fill=(0, 0, 0))
            total_redacted += 1

        # Apply all redactions on this page -- this STRIPS the underlying content
        page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_REMOVE)

    return total_redacted

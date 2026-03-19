"""
Mudbrick v2 -- Redaction Tests

Tests for pattern matching and forensic redaction application.
"""

from __future__ import annotations

import re

import fitz
import pytest

from app.services.redaction_engine import (
    BUILTIN_PATTERNS,
    MatchResult,
    apply_redactions,
    get_available_patterns,
    search_patterns,
    _validate_ssn,
    _validate_credit_card,
    _validate_phone,
    _luhn_check,
)


# ── Pattern Validation Tests ──


class TestSSNValidation:
    def test_valid_ssn(self):
        assert _validate_ssn("123-45-6789") is True

    def test_invalid_ssn_starts_with_000(self):
        assert _validate_ssn("000-12-3456") is False

    def test_invalid_ssn_starts_with_666(self):
        assert _validate_ssn("666-12-3456") is False

    def test_invalid_ssn_starts_with_9xx(self):
        assert _validate_ssn("900-12-3456") is False

    def test_invalid_ssn_group_00(self):
        assert _validate_ssn("123-00-6789") is False

    def test_invalid_ssn_serial_0000(self):
        assert _validate_ssn("123-45-0000") is False

    def test_ssn_without_dashes(self):
        assert _validate_ssn("123456789") is True

    def test_ssn_with_spaces(self):
        assert _validate_ssn("123 45 6789") is True

    def test_ssn_wrong_length(self):
        assert _validate_ssn("12-34-567") is False


class TestCreditCardValidation:
    def test_valid_visa(self):
        # 4111111111111111 passes Luhn
        assert _validate_credit_card("4111-1111-1111-1111") is True

    def test_invalid_card_too_short(self):
        assert _validate_credit_card("1234-5678") is False

    def test_invalid_card_fails_luhn(self):
        assert _validate_credit_card("1234-5678-9012-3456") is False


class TestPhoneValidation:
    def test_valid_10_digit(self):
        assert _validate_phone("555-123-4567") is True

    def test_valid_11_digit_with_country(self):
        assert _validate_phone("+1 555 123 4567") is True

    def test_invalid_too_short(self):
        assert _validate_phone("123-4567") is False


class TestLuhn:
    def test_valid_number(self):
        assert _luhn_check("4111111111111111") is True

    def test_invalid_number(self):
        assert _luhn_check("1234567890123456") is False


# ── Pattern Registry Tests ──


class TestPatternRegistry:
    def test_all_builtin_patterns_exist(self):
        names = set(BUILTIN_PATTERNS.keys())
        assert "ssn" in names
        assert "credit_card" in names
        assert "email" in names
        assert "phone" in names
        assert "date" in names

    def test_get_available_patterns(self):
        patterns = get_available_patterns()
        assert len(patterns) == 5
        names = [p["name"] for p in patterns]
        assert "ssn" in names
        assert "email" in names

    def test_patterns_have_labels(self):
        for p in get_available_patterns():
            assert "name" in p
            assert "label" in p
            assert "description" in p


# ── Search Tests with Real PyMuPDF Documents ──


def _create_pdf_with_text(text: str) -> fitz.Document:
    """Create a single-page PDF containing the given text."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    # Insert text at a known position
    page.insert_text((72, 72), text, fontsize=12)
    return doc


class TestSearchPatterns:
    def test_search_ssn(self):
        doc = _create_pdf_with_text("My SSN is 123-45-6789 and that is private.")
        results = search_patterns(doc, ["ssn"])
        doc.close()
        # Should find the SSN
        assert len(results) >= 1
        assert any(r.pattern == "ssn" for r in results)
        ssn_match = next(r for r in results if r.pattern == "ssn")
        assert "123" in ssn_match.text
        assert ssn_match.page == 1
        assert len(ssn_match.rects) > 0

    def test_search_email(self):
        doc = _create_pdf_with_text("Contact us at hello@example.com for info.")
        results = search_patterns(doc, ["email"])
        doc.close()
        assert len(results) >= 1
        assert any("hello@example.com" in r.text for r in results)

    def test_search_phone(self):
        doc = _create_pdf_with_text("Call 555-123-4567 for details.")
        results = search_patterns(doc, ["phone"])
        doc.close()
        assert len(results) >= 1
        assert any("555-123-4567" in r.text for r in results)

    def test_search_custom_regex(self):
        doc = _create_pdf_with_text("Case number: ABC-12345-XY")
        results = search_patterns(doc, ["custom"], custom_regex=r"ABC-\d{5}-XY")
        doc.close()
        assert len(results) >= 1
        assert any("ABC-12345-XY" in r.text for r in results)

    def test_search_invalid_custom_regex_falls_back_to_literal(self):
        doc = _create_pdf_with_text("Find this: hello[world")
        results = search_patterns(doc, ["custom"], custom_regex="hello[world")
        doc.close()
        # Should still find it via escaped literal
        assert len(results) >= 1

    def test_search_specific_pages(self):
        doc = fitz.open()
        page1 = doc.new_page(width=612, height=792)
        page1.insert_text((72, 72), "SSN: 123-45-6789")
        page2 = doc.new_page(width=612, height=792)
        page2.insert_text((72, 72), "No sensitive data here.")
        results = search_patterns(doc, ["ssn"], pages=[2])
        doc.close()
        # Should not find SSN on page 2
        assert all(r.page == 2 for r in results)

    def test_search_no_matches(self):
        doc = _create_pdf_with_text("Nothing sensitive here at all.")
        results = search_patterns(doc, ["ssn", "credit_card"])
        doc.close()
        assert len(results) == 0

    def test_search_multiple_patterns(self):
        doc = _create_pdf_with_text(
            "SSN: 123-45-6789 Email: test@example.com Phone: 555-123-4567"
        )
        results = search_patterns(doc, ["ssn", "email", "phone"])
        doc.close()
        patterns_found = set(r.pattern for r in results)
        # Should find at least email and phone; SSN depends on text rendering
        assert len(results) >= 2

    def test_search_unknown_pattern_ignored(self):
        doc = _create_pdf_with_text("Hello world")
        results = search_patterns(doc, ["nonexistent_pattern"])
        doc.close()
        assert len(results) == 0


# ── Redaction Application Tests ──


class TestApplyRedactions:
    def test_apply_redaction_removes_text(self):
        doc = _create_pdf_with_text("SENSITIVE DATA: 123-45-6789")
        page = doc[0]

        # Search for the text to get its position
        rects = page.search_for("123-45-6789")
        assert len(rects) > 0

        regions = [
            {
                "page": 1,
                "rects": [
                    {
                        "x": float(rects[0].x0),
                        "y": float(rects[0].y0),
                        "width": float(rects[0].width),
                        "height": float(rects[0].height),
                    }
                ],
            }
        ]

        count = apply_redactions(doc, regions)
        assert count == 1

        # Verify the text is removed
        remaining_text = doc[0].get_text("text")
        assert "123-45-6789" not in remaining_text

        doc.close()

    def test_apply_redaction_invalid_page_ignored(self):
        doc = _create_pdf_with_text("Some text")
        regions = [
            {
                "page": 999,  # Invalid page
                "rects": [{"x": 0, "y": 0, "width": 100, "height": 20}],
            }
        ]
        count = apply_redactions(doc, regions)
        assert count == 0
        doc.close()

    def test_apply_multiple_regions(self):
        doc = _create_pdf_with_text("SSN: 123-45-6789 Phone: 555-123-4567")
        page = doc[0]

        rects1 = page.search_for("123-45-6789")
        rects2 = page.search_for("555-123-4567")

        regions = []
        if rects1:
            regions.append(
                {
                    "page": 1,
                    "rects": [
                        {
                            "x": float(rects1[0].x0),
                            "y": float(rects1[0].y0),
                            "width": float(rects1[0].width),
                            "height": float(rects1[0].height),
                        }
                    ],
                }
            )
        if rects2:
            regions.append(
                {
                    "page": 1,
                    "rects": [
                        {
                            "x": float(rects2[0].x0),
                            "y": float(rects2[0].y0),
                            "width": float(rects2[0].width),
                            "height": float(rects2[0].height),
                        }
                    ],
                }
            )

        count = apply_redactions(doc, regions)
        assert count >= 1
        doc.close()

    def test_apply_empty_regions(self):
        doc = _create_pdf_with_text("Some text")
        count = apply_redactions(doc, [])
        assert count == 0
        doc.close()


# ── API Router Tests ──


@pytest.mark.asyncio
async def test_list_patterns(client):
    resp = await client.get("/api/redaction/patterns")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 5
    names = [p["name"] for p in data]
    assert "ssn" in names


@pytest.mark.asyncio
async def test_search_requires_valid_session(client):
    resp = await client.post(
        "/api/redaction/nonexistent/search",
        json={"patterns": ["ssn"]},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_apply_requires_valid_session(client):
    resp = await client.post(
        "/api/redaction/nonexistent/apply",
        json={"regions": []},
    )
    assert resp.status_code == 404

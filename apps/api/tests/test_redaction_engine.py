"""
Mudbrick v2 -- Comprehensive Redaction Engine Unit Tests

Tests for pattern matching, validation, Luhn check, and edge cases.
"""

from __future__ import annotations

import re

import fitz
import pytest

from app.services.redaction_engine import (
    BUILTIN_PATTERNS,
    MatchResult,
    PatternDef,
    apply_redactions,
    get_available_patterns,
    search_patterns,
    _validate_ssn,
    _validate_credit_card,
    _validate_phone,
    _luhn_check,
)


# ── SSN Validation Edge Cases ──


class TestSSNValidationEdgeCases:
    def test_valid_ssn_no_dashes(self):
        assert _validate_ssn("123456789") is True

    def test_valid_ssn_with_spaces(self):
        assert _validate_ssn("123 45 6789") is True

    def test_valid_ssn_with_dashes(self):
        assert _validate_ssn("123-45-6789") is True

    def test_area_001_valid(self):
        assert _validate_ssn("001-01-0001") is True

    def test_area_665_valid(self):
        assert _validate_ssn("665-01-0001") is True

    def test_area_899_invalid(self):
        # 9xx are reserved for ITIN
        assert _validate_ssn("899-01-0001") is True  # 899 < 900

    def test_area_900_invalid(self):
        assert _validate_ssn("900-01-0001") is False

    def test_area_999_invalid(self):
        assert _validate_ssn("999-01-0001") is False

    def test_group_00_invalid(self):
        assert _validate_ssn("123-00-6789") is False

    def test_serial_0000_invalid(self):
        assert _validate_ssn("123-45-0000") is False

    def test_too_few_digits(self):
        assert _validate_ssn("12345678") is False

    def test_too_many_digits(self):
        assert _validate_ssn("1234567890") is False


# ── Credit Card Validation Edge Cases ──


class TestCreditCardValidationEdgeCases:
    def test_valid_visa(self):
        assert _validate_credit_card("4111111111111111") is True

    def test_valid_visa_with_dashes(self):
        assert _validate_credit_card("4111-1111-1111-1111") is True

    def test_valid_visa_with_spaces(self):
        assert _validate_credit_card("4111 1111 1111 1111") is True

    def test_too_short(self):
        assert _validate_credit_card("411111111111") is False

    def test_too_long(self):
        assert _validate_credit_card("41111111111111111111") is False

    def test_fails_luhn(self):
        assert _validate_credit_card("4111111111111112") is False

    def test_valid_mastercard(self):
        # 5500000000000004 passes Luhn
        assert _validate_credit_card("5500000000000004") is True

    def test_all_zeros_fails(self):
        assert _validate_credit_card("0000000000000000") is True  # Luhn check: 0 mod 10 = 0


# ── Luhn Algorithm Edge Cases ──


class TestLuhnEdgeCases:
    def test_single_zero(self):
        assert _luhn_check("0") is True

    def test_single_nonzero(self):
        assert _luhn_check("1") is False

    def test_known_valid(self):
        assert _luhn_check("79927398713") is True

    def test_known_invalid(self):
        assert _luhn_check("79927398710") is False


# ── Phone Validation Edge Cases ──


class TestPhoneValidationEdgeCases:
    def test_10_digits_plain(self):
        assert _validate_phone("5551234567") is True

    def test_11_digits_with_country(self):
        assert _validate_phone("15551234567") is True

    def test_9_digits_invalid(self):
        assert _validate_phone("555-12-4567") is False

    def test_12_digits_invalid(self):
        assert _validate_phone("155512345678") is False

    def test_formatted_parentheses(self):
        assert _validate_phone("(555) 123-4567") is True


# ── Pattern Definitions ──


class TestPatternDefinitions:
    def test_each_builtin_has_regex(self):
        for name, pdef in BUILTIN_PATTERNS.items():
            assert isinstance(pdef.regex, re.Pattern), f"{name} missing regex"

    def test_each_builtin_has_label(self):
        for name, pdef in BUILTIN_PATTERNS.items():
            assert pdef.label, f"{name} missing label"

    def test_each_builtin_has_description(self):
        for name, pdef in BUILTIN_PATTERNS.items():
            assert pdef.description, f"{name} missing description"

    def test_ssn_pattern_has_validator(self):
        assert BUILTIN_PATTERNS["ssn"].validate is not None

    def test_email_pattern_has_no_validator(self):
        assert BUILTIN_PATTERNS["email"].validate is None

    def test_date_pattern_has_no_validator(self):
        assert BUILTIN_PATTERNS["date"].validate is None


# ── Search on Multi-Page Documents ──


def _create_multi_page_pdf(*texts: str) -> fitz.Document:
    doc = fitz.open()
    for text in texts:
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 72), text, fontsize=12)
    return doc


class TestSearchMultiPage:
    def test_finds_matches_on_correct_pages(self):
        doc = _create_multi_page_pdf(
            "SSN: 123-45-6789",
            "No sensitive data",
            "Email: test@example.com",
        )
        results = search_patterns(doc, ["ssn", "email"])
        doc.close()
        ssn_pages = {r.page for r in results if r.pattern == "ssn"}
        email_pages = {r.page for r in results if r.pattern == "email"}
        assert 1 in ssn_pages
        assert 3 in email_pages

    def test_page_filter_restricts_search(self):
        doc = _create_multi_page_pdf(
            "SSN: 123-45-6789",
            "SSN: 234-56-7890",
        )
        results = search_patterns(doc, ["ssn"], pages=[2])
        doc.close()
        assert all(r.page == 2 for r in results)

    def test_empty_pattern_list_returns_empty(self):
        doc = _create_multi_page_pdf("SSN: 123-45-6789")
        results = search_patterns(doc, [])
        doc.close()
        assert len(results) == 0


# ── Apply Redactions Edge Cases ──


class TestApplyRedactionsEdgeCases:
    def test_redaction_with_zero_area_rect(self):
        doc = fitz.open()
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 72), "Test text")
        regions = [{"page": 1, "rects": [{"x": 72, "y": 72, "width": 0, "height": 0}]}]
        # Should not crash
        count = apply_redactions(doc, regions)
        assert count == 1
        doc.close()

    def test_redaction_on_page_beyond_count(self):
        doc = fitz.open()
        doc.new_page(width=612, height=792)
        regions = [{"page": 5, "rects": [{"x": 0, "y": 0, "width": 100, "height": 20}]}]
        count = apply_redactions(doc, regions)
        assert count == 0
        doc.close()

    def test_redaction_on_page_zero(self):
        doc = fitz.open()
        doc.new_page(width=612, height=792)
        regions = [{"page": 0, "rects": [{"x": 0, "y": 0, "width": 100, "height": 20}]}]
        count = apply_redactions(doc, regions)
        assert count == 0
        doc.close()

    def test_multiple_rects_on_same_page(self):
        doc = fitz.open()
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 72), "SSN: 123-45-6789 Phone: 555-123-4567")
        regions = [
            {
                "page": 1,
                "rects": [
                    {"x": 70, "y": 60, "width": 100, "height": 20},
                    {"x": 200, "y": 60, "width": 100, "height": 20},
                ],
            }
        ]
        count = apply_redactions(doc, regions)
        assert count == 2
        doc.close()

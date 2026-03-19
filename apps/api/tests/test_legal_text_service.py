"""
Mudbrick v2 -- Legal Text Service Unit Tests

Tests for Bates format generation, header placeholder replacement,
exhibit format, page label operations, and helper functions.
"""

from __future__ import annotations

import fitz
import pytest

from app.services.legal_text import (
    BatesOptions,
    HeaderFooterOptions,
    apply_bates_numbers,
    apply_headers_footers,
    build_text_rect,
    replace_tokens,
    resolve_font_name,
    parse_hex_color,
    inches_to_points,
    text_box_height,
    mirrored_zone,
    default_filename_from_path,
    STANDARD_FONTS,
    POSITION_ALIGNS,
)


# ── Helper Functions ──


class TestParseHexColor:
    def test_black(self):
        assert parse_hex_color("#000000") == (0.0, 0.0, 0.0)

    def test_white(self):
        r, g, b = parse_hex_color("#ffffff")
        assert abs(r - 1.0) < 0.01
        assert abs(g - 1.0) < 0.01
        assert abs(b - 1.0) < 0.01

    def test_red(self):
        r, g, b = parse_hex_color("#ff0000")
        assert abs(r - 1.0) < 0.01
        assert g == 0.0
        assert b == 0.0

    def test_invalid_raises(self):
        with pytest.raises(ValueError, match="Invalid color"):
            parse_hex_color("not-a-color")

    def test_missing_hash(self):
        with pytest.raises(ValueError):
            parse_hex_color("ff0000")

    def test_wrong_length(self):
        with pytest.raises(ValueError):
            parse_hex_color("#fff")


class TestInchesToPoints:
    def test_one_inch(self):
        assert inches_to_points(1.0) == 72.0

    def test_half_inch(self):
        assert inches_to_points(0.5) == 36.0

    def test_zero(self):
        assert inches_to_points(0.0) == 0.0

    def test_negative_clamped(self):
        assert inches_to_points(-1.0) == 0.0


class TestTextBoxHeight:
    def test_default_minimum(self):
        assert text_box_height(8) == 18.0  # 8 * 1.8 = 14.4, clamped to 18

    def test_large_font(self):
        assert text_box_height(20) == 36.0  # 20 * 1.8 = 36


class TestResolveFontName:
    def test_helvetica(self):
        assert resolve_font_name("Helvetica") == "Helvetica"

    def test_times_roman(self):
        assert resolve_font_name("TimesRoman") == "Times-Roman"

    def test_courier_bold(self):
        assert resolve_font_name("CourierBold") == "Courier-Bold"

    def test_unknown_defaults_to_helvetica(self):
        assert resolve_font_name("FancyFont") == "Helvetica"


class TestMirroredZone:
    def test_no_mirror_returns_same(self):
        assert mirrored_zone("top_left", 1, False) == "top_left"

    def test_mirror_even_page_swaps_left_right(self):
        assert mirrored_zone("top_left", 2, True) == "top_right"
        assert mirrored_zone("top_right", 2, True) == "top_left"
        assert mirrored_zone("bottom_left", 2, True) == "bottom_right"

    def test_mirror_odd_page_no_swap(self):
        assert mirrored_zone("top_left", 1, True) == "top_left"
        assert mirrored_zone("top_left", 3, True) == "top_left"

    def test_center_not_swapped(self):
        assert mirrored_zone("top_center", 2, True) == "top_center"


class TestReplaceTokens:
    def test_page_token(self):
        result = replace_tokens("{page}", page_num=3, total_pages=10, filename="test.pdf", metadata={})
        assert result == "3"

    def test_pages_token(self):
        result = replace_tokens("{pages}", page_num=1, total_pages=50, filename="", metadata={})
        assert result == "50"

    def test_page_of_pages(self):
        result = replace_tokens("{page}/{pages}", page_num=2, total_pages=5, filename="", metadata={})
        assert result == "2/5"

    def test_filename_token(self):
        result = replace_tokens("{filename}", page_num=1, total_pages=1, filename="doc.pdf", metadata={})
        assert result == "doc.pdf"

    def test_author_token(self):
        result = replace_tokens("{author}", page_num=1, total_pages=1, filename="", metadata={"author": "John"})
        assert result == "John"

    def test_empty_template(self):
        result = replace_tokens("", page_num=1, total_pages=1, filename="", metadata={})
        assert result == ""

    def test_static_text(self):
        result = replace_tokens("CONFIDENTIAL", page_num=1, total_pages=1, filename="", metadata={})
        assert result == "CONFIDENTIAL"


class TestDefaultFilenameFromPath:
    def test_windows_path(self):
        assert default_filename_from_path("C:\\Users\\test\\doc.pdf") == "doc.pdf"

    def test_empty(self):
        assert default_filename_from_path("") == ""


# ── Bates Numbering ──


class TestApplyBatesNumbers:
    def test_basic_bates(self):
        doc = fitz.open()
        for i in range(3):
            doc.new_page(width=612, height=792)

        opts = BatesOptions(prefix="MB-", start_num=1, zero_pad=4)
        first, last = apply_bates_numbers(doc, opts)

        assert first == "MB-0001"
        assert last == "MB-0003"

        # Verify text appears on pages
        for i in range(3):
            text = doc[i].get_text("text")
            assert f"MB-{str(i+1).zfill(4)}" in text

        doc.close()

    def test_bates_with_suffix(self):
        doc = fitz.open()
        doc.new_page(width=612, height=792)

        opts = BatesOptions(prefix="DOC-", suffix="-A", start_num=1, zero_pad=3)
        first, last = apply_bates_numbers(doc, opts)

        assert first == "DOC-001-A"
        assert last == "DOC-001-A"
        doc.close()

    def test_bates_custom_start(self):
        doc = fitz.open()
        for _ in range(2):
            doc.new_page(width=612, height=792)

        opts = BatesOptions(prefix="", start_num=100, zero_pad=6)
        first, last = apply_bates_numbers(doc, opts)

        assert first == "000100"
        assert last == "000101"
        doc.close()

    def test_bates_page_range(self):
        doc = fitz.open()
        for _ in range(5):
            doc.new_page(width=612, height=792)

        opts = BatesOptions(prefix="P-", start_num=1, zero_pad=3, start_page=2, end_page=4)
        first, last = apply_bates_numbers(doc, opts)

        assert first == "P-001"
        assert last == "P-003"
        # Page 1 and 5 should not have Bates numbers
        assert "P-" not in doc[0].get_text("text")
        assert "P-" not in doc[4].get_text("text")
        doc.close()


# ── Headers and Footers ──


class TestApplyHeadersFooters:
    def test_basic_header(self):
        doc = fitz.open()
        for _ in range(3):
            doc.new_page(width=612, height=792)

        opts = HeaderFooterOptions(top_center="CONFIDENTIAL")
        apply_headers_footers(doc, opts)

        for i in range(3):
            assert "CONFIDENTIAL" in doc[i].get_text("text")
        doc.close()

    def test_footer_with_page_numbers(self):
        doc = fitz.open()
        for _ in range(3):
            doc.new_page(width=612, height=792)

        opts = HeaderFooterOptions(bottom_center="{page}/{pages}")
        apply_headers_footers(doc, opts)

        assert "1/3" in doc[0].get_text("text")
        assert "2/3" in doc[1].get_text("text")
        assert "3/3" in doc[2].get_text("text")
        doc.close()

    def test_skip_first_page(self):
        doc = fitz.open()
        for _ in range(3):
            doc.new_page(width=612, height=792)

        opts = HeaderFooterOptions(top_center="DRAFT", skip_first=True)
        apply_headers_footers(doc, opts)

        assert "DRAFT" not in doc[0].get_text("text")
        assert "DRAFT" in doc[1].get_text("text")
        doc.close()

    def test_skip_last_page(self):
        doc = fitz.open()
        for _ in range(3):
            doc.new_page(width=612, height=792)

        opts = HeaderFooterOptions(bottom_center="Footer", skip_last=True)
        apply_headers_footers(doc, opts)

        assert "Footer" in doc[0].get_text("text")
        assert "Footer" not in doc[2].get_text("text")
        doc.close()

    def test_empty_templates_no_op(self):
        doc = fitz.open()
        doc.new_page(width=612, height=792)

        opts = HeaderFooterOptions()  # All empty
        apply_headers_footers(doc, opts)
        # Should not crash, text should be minimal
        doc.close()

    def test_filename_token(self):
        doc = fitz.open()
        doc.new_page(width=612, height=792)

        opts = HeaderFooterOptions(top_left="{filename}")
        apply_headers_footers(doc, opts, fallback_filename="report.pdf")

        assert "report.pdf" in doc[0].get_text("text")
        doc.close()


# ── Build Text Rect ──


class TestBuildTextRect:
    def test_top_position(self):
        page_rect = fitz.Rect(0, 0, 612, 792)
        rect = build_text_rect(page_rect, "top_center", 36.0, 18.0)
        assert rect.y0 == 36.0
        assert rect.y1 == 54.0

    def test_bottom_position(self):
        page_rect = fitz.Rect(0, 0, 612, 792)
        rect = build_text_rect(page_rect, "bottom_center", 36.0, 18.0)
        assert rect.y0 == 792 - 36.0 - 18.0

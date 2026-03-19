"""
Mudbrick v2 -- Comparison Engine Unit Tests

Tests for document comparison: identical docs, different page counts,
modified pages, threshold behavior.
"""

from __future__ import annotations

from pathlib import Path

import fitz
import pytest

from app.services.comparison_engine import (
    ChangeType,
    ComparisonResult,
    compare_documents,
)


def _create_pdf(tmp_path: Path, name: str, pages: list[str]) -> str:
    """Create a PDF with specified page texts, return file path."""
    doc = fitz.open()
    for text in pages:
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 72), text, fontsize=16)
    path = tmp_path / name
    doc.save(str(path))
    doc.close()
    return str(path)


class TestCompareIdentical:
    def test_same_file(self, tmp_path):
        path = _create_pdf(tmp_path, "same.pdf", ["Page 1", "Page 2"])
        result = compare_documents(path, path, dpi=72, include_diff_images=False)
        assert result.summary.unchanged == 2
        assert result.summary.added == 0
        assert result.summary.deleted == 0
        assert result.summary.modified == 0

    def test_identical_content(self, tmp_path):
        path1 = _create_pdf(tmp_path, "a.pdf", ["Hello World"])
        path2 = _create_pdf(tmp_path, "b.pdf", ["Hello World"])
        result = compare_documents(path1, path2, dpi=72, include_diff_images=False)
        assert result.summary.unchanged == 1


class TestComparePageCounts:
    def test_added_pages(self, tmp_path):
        path1 = _create_pdf(tmp_path, "short.pdf", ["Page 1"])
        path2 = _create_pdf(tmp_path, "long.pdf", ["Page 1", "Page 2", "Page 3"])
        result = compare_documents(path1, path2, dpi=72, include_diff_images=False)
        assert result.summary.added == 2
        added = [c for c in result.changes if c.type == ChangeType.ADDED]
        assert len(added) == 2

    def test_deleted_pages(self, tmp_path):
        path1 = _create_pdf(tmp_path, "long.pdf", ["Page 1", "Page 2", "Page 3"])
        path2 = _create_pdf(tmp_path, "short.pdf", ["Page 1"])
        result = compare_documents(path1, path2, dpi=72, include_diff_images=False)
        assert result.summary.deleted == 2

    def test_added_pages_have_diff_score_1(self, tmp_path):
        path1 = _create_pdf(tmp_path, "a.pdf", ["Page 1"])
        path2 = _create_pdf(tmp_path, "b.pdf", ["Page 1", "Page 2"])
        result = compare_documents(path1, path2, dpi=72, include_diff_images=False)
        added = [c for c in result.changes if c.type == ChangeType.ADDED]
        assert all(c.diff_score == 1.0 for c in added)


class TestCompareModified:
    def test_modified_page_detected(self, tmp_path):
        path1 = _create_pdf(tmp_path, "orig.pdf", ["Original text on page 1"])
        path2 = _create_pdf(tmp_path, "mod.pdf", ["COMPLETELY DIFFERENT TEXT HERE"])
        result = compare_documents(path1, path2, dpi=72, include_diff_images=False)
        modified = [c for c in result.changes if c.type == ChangeType.MODIFIED]
        assert len(modified) == 1
        assert modified[0].diff_score > 0

    def test_diff_images_included_when_requested(self, tmp_path):
        path1 = _create_pdf(tmp_path, "a.pdf", ["Text A"])
        path2 = _create_pdf(tmp_path, "b.pdf", ["Text B completely different"])
        result = compare_documents(path1, path2, dpi=72, include_diff_images=True)
        modified = [c for c in result.changes if c.type == ChangeType.MODIFIED]
        if modified:
            assert modified[0].diff_image_bytes is not None
            assert modified[0].diff_image_bytes[:8] == b"\x89PNG\r\n\x1a\n"

    def test_diff_images_excluded_when_not_requested(self, tmp_path):
        path1 = _create_pdf(tmp_path, "a.pdf", ["Text A"])
        path2 = _create_pdf(tmp_path, "b.pdf", ["Text B completely different"])
        result = compare_documents(path1, path2, dpi=72, include_diff_images=False)
        modified = [c for c in result.changes if c.type == ChangeType.MODIFIED]
        if modified:
            assert modified[0].diff_image_bytes is None


class TestCompareResultStructure:
    def test_changes_ordered_by_page(self, tmp_path):
        path1 = _create_pdf(tmp_path, "a.pdf", ["P1", "P2", "P3"])
        path2 = _create_pdf(tmp_path, "b.pdf", ["P1", "P2", "P3"])
        result = compare_documents(path1, path2, dpi=72, include_diff_images=False)
        pages = [c.page for c in result.changes]
        assert pages == [1, 2, 3]

    def test_summary_counts_match_changes(self, tmp_path):
        path1 = _create_pdf(tmp_path, "a.pdf", ["P1", "P2"])
        path2 = _create_pdf(tmp_path, "b.pdf", ["P1", "P2", "P3"])
        result = compare_documents(path1, path2, dpi=72, include_diff_images=False)
        total = (
            result.summary.added
            + result.summary.deleted
            + result.summary.modified
            + result.summary.unchanged
        )
        assert total == len(result.changes)


class TestCompareFileErrors:
    def test_nonexistent_file_raises(self, tmp_path):
        path = _create_pdf(tmp_path, "exists.pdf", ["Page 1"])
        with pytest.raises(Exception):
            compare_documents(path, "/nonexistent/file.pdf", dpi=72)

    def test_both_nonexistent_raises(self, tmp_path):
        with pytest.raises(Exception):
            compare_documents("/fake1.pdf", "/fake2.pdf", dpi=72)

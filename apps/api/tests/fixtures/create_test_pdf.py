"""
Helper script to create test PDF fixtures using PyMuPDF.
Run: python -m tests.fixtures.create_test_pdf
"""

from pathlib import Path

import fitz


def create_single_page_pdf() -> bytes:
    """Create a minimal 1-page PDF with text."""
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "Test PDF - Page 1", fontsize=16)
    data = doc.tobytes()
    doc.close()
    return data


def create_multi_page_pdf(page_count: int = 3) -> bytes:
    """Create a multi-page PDF with text on each page."""
    doc = fitz.open()
    for i in range(page_count):
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 72), f"Test PDF - Page {i + 1}", fontsize=16)
        page.insert_text(
            (72, 100),
            f"This is test content for page {i + 1} of {page_count}.",
            fontsize=12,
        )
    data = doc.tobytes()
    doc.close()
    return data


if __name__ == "__main__":
    fixtures_dir = Path(__file__).parent
    fixtures_dir.mkdir(exist_ok=True)

    single = create_single_page_pdf()
    (fixtures_dir / "single_page.pdf").write_bytes(single)
    print(f"Created single_page.pdf ({len(single)} bytes)")

    multi = create_multi_page_pdf(3)
    (fixtures_dir / "multi_page.pdf").write_bytes(multi)
    print(f"Created multi_page.pdf ({len(multi)} bytes)")

"""
Mudbrick v2 -- OCR Engine

pytesseract wrapper: render PDF page to image via PyMuPDF, run OCR,
return words with bounding boxes and confidence scores.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
from PIL import Image

from ..config import settings

try:
    import pytesseract
except ImportError:
    pytesseract = None  # type: ignore[assignment]


@dataclass
class OcrWord:
    """A single word detected by OCR."""

    text: str
    confidence: float  # 0.0 to 1.0
    x: float  # PDF coordinates
    y: float
    width: float
    height: float
    block_num: int = 0
    line_num: int = 0
    word_num: int = 0


@dataclass
class OcrPageResult:
    """OCR results for a single page."""

    page: int  # 1-indexed
    words: list[OcrWord] = field(default_factory=list)
    word_count: int = 0
    avg_confidence: float = 0.0
    language: str = "eng"


@dataclass
class OcrDocumentResult:
    """OCR results for the entire document."""

    pages: list[OcrPageResult] = field(default_factory=list)
    total_words: int = 0
    avg_confidence: float = 0.0
    language: str = "eng"

    def to_dict(self) -> dict:
        """Convert to JSON-serializable dict."""
        return asdict(self)


def _configure_tesseract() -> None:
    """Set the tesseract command path from config if available."""
    if pytesseract is None:
        return
    cmd = settings.tesseract_cmd
    if cmd and cmd != "tesseract":
        pytesseract.pytesseract.tesseract_cmd = cmd


def _render_page_to_image(page: fitz.Page, dpi: int = 300) -> Image.Image:
    """Render a PDF page to a PIL Image at the given DPI.

    Args:
        page: PyMuPDF page object.
        dpi: Resolution for rendering (higher = better OCR, slower).

    Returns:
        PIL Image of the rendered page.
    """
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, alpha=False)
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    return img


def ocr_page(
    page: fitz.Page,
    page_num: int,
    language: str = "eng",
    dpi: int = 300,
) -> OcrPageResult:
    """Run OCR on a single PDF page.

    Args:
        page: PyMuPDF page object.
        page_num: 1-indexed page number.
        language: Tesseract language code.
        dpi: Resolution for rendering.

    Returns:
        OcrPageResult with detected words and confidence scores.
    """
    if pytesseract is None:
        raise RuntimeError(
            "pytesseract is not installed. Install it with: pip install pytesseract"
        )

    _configure_tesseract()

    # Render page to image
    img = _render_page_to_image(page, dpi=dpi)
    img_width, img_height = img.size

    # Run OCR with word-level data
    ocr_data = pytesseract.image_to_data(
        img, lang=language, output_type=pytesseract.Output.DICT
    )

    # PDF page dimensions for coordinate conversion
    page_rect = page.rect
    pdf_width = page_rect.width
    pdf_height = page_rect.height

    # Scale factors: image pixels -> PDF points
    scale_x = pdf_width / img_width
    scale_y = pdf_height / img_height

    words: list[OcrWord] = []
    total_conf = 0.0
    conf_count = 0

    n_boxes = len(ocr_data["text"])
    for i in range(n_boxes):
        text = ocr_data["text"][i].strip()
        conf = float(ocr_data["conf"][i])

        # Skip empty or low-confidence noise
        if not text or conf < 0:
            continue

        # Normalize confidence to 0-1 range (tesseract returns 0-100)
        conf_normalized = conf / 100.0

        # Convert image coordinates to PDF coordinates
        img_x = float(ocr_data["left"][i])
        img_y = float(ocr_data["top"][i])
        img_w = float(ocr_data["width"][i])
        img_h = float(ocr_data["height"][i])

        pdf_x = img_x * scale_x
        pdf_y = img_y * scale_y
        pdf_w = img_w * scale_x
        pdf_h = img_h * scale_y

        words.append(
            OcrWord(
                text=text,
                confidence=round(conf_normalized, 3),
                x=round(pdf_x, 2),
                y=round(pdf_y, 2),
                width=round(pdf_w, 2),
                height=round(pdf_h, 2),
                block_num=int(ocr_data["block_num"][i]),
                line_num=int(ocr_data["line_num"][i]),
                word_num=int(ocr_data["word_num"][i]),
            )
        )

        total_conf += conf_normalized
        conf_count += 1

    avg_confidence = round(total_conf / conf_count, 3) if conf_count > 0 else 0.0

    return OcrPageResult(
        page=page_num,
        words=words,
        word_count=len(words),
        avg_confidence=avg_confidence,
        language=language,
    )


def save_ocr_results(session_dir: Path, result: OcrDocumentResult) -> Path:
    """Save OCR results to the session directory as JSON.

    Args:
        session_dir: Path to the session directory.
        result: OCR results to save.

    Returns:
        Path to the saved JSON file.
    """
    output_path = session_dir / "ocr_results.json"
    output_path.write_text(
        json.dumps(result.to_dict(), indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return output_path


def load_ocr_results(session_dir: Path) -> Optional[OcrDocumentResult]:
    """Load cached OCR results from the session directory.

    Returns None if no cached results exist.
    """
    results_path = session_dir / "ocr_results.json"
    if not results_path.exists():
        return None

    data = json.loads(results_path.read_text(encoding="utf-8"))

    pages = []
    for page_data in data.get("pages", []):
        words = [OcrWord(**w) for w in page_data.get("words", [])]
        pages.append(
            OcrPageResult(
                page=page_data["page"],
                words=words,
                word_count=page_data.get("word_count", len(words)),
                avg_confidence=page_data.get("avg_confidence", 0.0),
                language=page_data.get("language", "eng"),
            )
        )

    return OcrDocumentResult(
        pages=pages,
        total_words=data.get("total_words", sum(p.word_count for p in pages)),
        avg_confidence=data.get("avg_confidence", 0.0),
        language=data.get("language", "eng"),
    )

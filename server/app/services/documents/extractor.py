"""
Text Extraction — converts uploaded files to plain text.

Supported formats:
  .txt   — read as UTF-8 / latin-1 (always available, no extra dep)
  .pdf   — pypdf (pure-Python, no native binaries)
  .docx  — python-docx

Extractor registry is a plain dict; add new entries as more formats are needed.

Usage:
    text = extract_text(file_bytes, filename="document.pdf")
"""

from __future__ import annotations

import io
import logging

logger = logging.getLogger(__name__)

# ── Supported MIME / extension map ────────────────────────────────────────────

# Maps lower-case extension → extractor function name
_SUPPORTED_EXTENSIONS = {".txt", ".pdf", ".docx"}


def supported_extensions() -> frozenset[str]:
    return frozenset(_SUPPORTED_EXTENSIONS)


# ── Extraction errors ─────────────────────────────────────────────────────────

class ExtractionError(Exception):
    """Raised when text cannot be extracted from the file."""


class UnsupportedFileType(ExtractionError):
    """Raised when the file extension is not supported."""


# ── Individual extractors ─────────────────────────────────────────────────────

def _extract_txt(data: bytes) -> str:
    for enc in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ExtractionError("Could not decode text file with any supported encoding.")


def _extract_pdf(data: bytes) -> str:
    try:
        from pypdf import PdfReader  # noqa: PLC0415 — optional dep
    except ImportError as exc:
        raise ExtractionError("pypdf is not installed. Add pypdf to requirements.txt.") from exc

    reader = PdfReader(io.BytesIO(data))
    pages: list[str] = []
    for page in reader.pages:
        text = page.extract_text() or ""
        pages.append(text)
    result = "\n".join(pages)
    if not result.strip():
        raise ExtractionError("PDF appears to contain no extractable text (scanned image PDF?).")
    return result


def _extract_docx(data: bytes) -> str:
    try:
        import docx  # python-docx  # noqa: PLC0415
    except ImportError as exc:
        raise ExtractionError("python-docx is not installed. Add python-docx to requirements.txt.") from exc

    doc = docx.Document(io.BytesIO(data))
    texts: list[str] = []

    for p in doc.paragraphs:
        if p.text.strip():
            texts.append(p.text)

    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                if cell.text.strip():
                    texts.append(cell.text)

    result = "\n".join(texts)
    if not result.strip():
        raise ExtractionError("DOCX document contains no extractable text.")
    return result


# ── Registry ──────────────────────────────────────────────────────────────────

_EXTRACTORS = {
    ".txt":  _extract_txt,
    ".pdf":  _extract_pdf,
    ".docx": _extract_docx,
}


# ── Public API ────────────────────────────────────────────────────────────────

def extension_from_filename(filename: str) -> str:
    """Return the lower-case extension including the dot, e.g. '.pdf'."""
    import os
    _, ext = os.path.splitext(filename)
    return ext.lower()


def extract_text(data: bytes, filename: str) -> str:
    """
    Extract plain text from an uploaded file.

    Args:
        data:     Raw file bytes.
        filename: Original filename (used to determine format).

    Returns:
        Extracted plain-text string.

    Raises:
        UnsupportedFileType: Extension is not in the supported set.
        ExtractionError:     Extraction failed (e.g. corrupted file).
    """
    ext = extension_from_filename(filename)
    extractor = _EXTRACTORS.get(ext)
    if extractor is None:
        raise UnsupportedFileType(
            f"File type '{ext}' is not supported. "
            f"Supported: {', '.join(sorted(_SUPPORTED_EXTENSIONS))}"
        )
    logger.debug("Extracting text from '%s' (%d bytes)", filename, len(data))
    return extractor(data)

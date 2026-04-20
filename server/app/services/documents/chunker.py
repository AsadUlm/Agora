"""
Text Chunker — splits extracted document text into overlapping chunks.

Strategy: paragraph-aware split with a target character budget per chunk.

Algorithm:
  1. Split on double newlines to get paragraphs.
  2. Group paragraphs greedily until the budget (CHUNK_SIZE chars) is reached.
  3. When a single paragraph exceeds the budget, split it on sentence boundaries.
  4. Apply a small overlap: carry the last OVERLAP_CHARS chars of each chunk
     into the beginning of the next chunk to avoid losing context at boundaries.

Constants are tunable via function arguments so callers (and tests) can override.

These defaults suit general-purpose RAG over English documents:
  CHUNK_SIZE   = 800 chars  (~160-200 tokens, fits well in 128k context windows)
  OVERLAP      = 100 chars
  MIN_CHUNK    = 80  chars  (discard tiny trailing fragments)
"""

from __future__ import annotations

import re

CHUNK_SIZE = 800
OVERLAP = 100
MIN_CHUNK = 80


def chunk_text(
    text: str,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = OVERLAP,
    min_chunk: int = MIN_CHUNK,
) -> list[str]:
    """
    Split *text* into overlapping chunks of approximately *chunk_size* chars.

    Returns:
        Ordered list of chunk strings.  Never empty — returns at least one chunk
        if the source text is non-empty.
    """
    if not text.strip():
        return []

    # Step 1: split into paragraphs
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]

    # Step 2: group paragraphs into chunks
    chunks: list[str] = []
    current_parts: list[str] = []
    current_len = 0
    carry = ""  # overlap carry-over from previous chunk

    for para in paragraphs:
        # If a single paragraph exceeds the budget, split it at sentence boundaries
        if len(para) > chunk_size:
            sentences = _split_sentences(para)
        else:
            sentences = [para]

        for sentence in sentences:
            if current_len + len(sentence) + 1 > chunk_size and current_parts:
                # Emit current chunk
                chunk_text_str = " ".join(current_parts)
                if carry:
                    chunk_text_str = carry + " " + chunk_text_str
                chunks.append(chunk_text_str)
                # Compute overlap carry-over
                carry = chunk_text_str[-overlap:] if overlap > 0 else ""
                current_parts = []
                current_len = 0

            current_parts.append(sentence)
            current_len += len(sentence) + 1

    # Emit remaining content
    if current_parts:
        chunk_text_str = " ".join(current_parts)
        if carry:
            chunk_text_str = carry + " " + chunk_text_str
        chunks.append(chunk_text_str)

    # Filter out tiny fragments
    chunks = [c for c in chunks if len(c) >= min_chunk]

    # Guarantee at least one chunk
    if not chunks and text.strip():
        chunks = [text.strip()]

    return chunks


def _split_sentences(text: str) -> list[str]:
    """Naive sentence splitter — split on '.', '!', '?' followed by whitespace."""
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p.strip() for p in parts if p.strip()]

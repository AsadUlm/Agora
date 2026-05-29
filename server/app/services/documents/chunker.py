"""
Text Chunker — splits extracted document text into overlapping chunks.

Multilingual-aware (Step 44):
  * Sentence detection supports English / Russian (`. ! ?`) plus
    Korean / Japanese / Chinese full-width punctuation (`。！？｡`).
  * Hard cap on chunk length — no chunk may exceed ``chunk_size`` by more than
    ``max(40, chunk_size // 5)`` characters. Oversized fragments cascade
    through sentence → clause (`; : , ， 、`) → whitespace → character-level
    fallback.
  * Short but meaningful chunks (numbers, identifiers, CJK/Cyrillic text,
    headings, key/value rows, list bullets) are preserved rather than dropped
    by the ``min_chunk`` filter.

Public API is unchanged:

    chunk_text(text, chunk_size=CHUNK_SIZE, overlap=OVERLAP,
               min_chunk=MIN_CHUNK) -> list[str]

so ``DocumentIngestionService`` and the re-embed script keep working without
modification.

Defaults:
    CHUNK_SIZE = 800  chars  (~160-200 tokens, fits 128k contexts comfortably)
    OVERLAP    = 100  chars
    MIN_CHUNK  = 80   chars  (soft floor; overridden when chunk carries signal)
"""

from __future__ import annotations

import re

CHUNK_SIZE = 800
OVERLAP = 100
MIN_CHUNK = 80


# ── Multilingual sentence / clause splitting ─────────────────────────────────

# Sentence-terminating punctuation across English, Russian, Korean, Japanese,
# Chinese. Includes both ASCII and full-width forms.
_SENT_END_CHARS = ".!?。！？｡"
_SENT_END_CLASS = r"[\.!\?。！？｡]"

# Clause-level punctuation used for the second-stage split when a single
# sentence is still longer than ``chunk_size``.
_CLAUSE_PUNCT = ";:,，、；：·・"
_CLAUSE_CLASS = r"[;:,，、；：·・]"

# Abbreviations we should not break on. Lowercased comparison.
_ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st",
    "vs", "etc", "e.g", "i.e", "fig", "no", "vol",
}

# Detects that a `.` belongs to a number / decimal / version.
_NUMBER_DOT = re.compile(r"\d\.\d")

# Bullet / list marker at start of line OR after whitespace.
_BULLET_RE = re.compile(r"^\s*(?:[-*•·●◦▪▫►]|\d+[\.\)]|[a-zA-Z][\.\)])\s+")
_BULLET_ANY_RE = re.compile(r"(?:^|\n|\s{2,})(?:[-*•·●◦▪▫►]|\d+[\.\)])\s+\S")

# Colon-separated key:value row, e.g. "Region: asia-northeast3".
_KV_RE = re.compile(r"^\s*[^\s:][^:\n]{0,80}:\s*\S")
_KV_ANY_RE = re.compile(r"(?:^|\n)\s*[A-Za-zА-Яа-я0-9][^:\n]{1,80}:\s*\S")

# Heading patterns.
_HEADING_RE = re.compile(
    r"^\s*(?:#{1,6}\s+\S|[\dIVX]+(?:\.[\dIVX]+)*\s+\S|[A-ZА-Я0-9][A-ZА-Я0-9 \-_/]{2,})\s*$"
)

# Character classes used by the short-chunk usefulness filter.
_CJK_CYRILLIC_RE = re.compile(
    r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff]"
)
_DIGIT_RE = re.compile(r"\d")
_UPPER_IDENT_RE = re.compile(r"[A-Z][A-Z0-9_\-]{2,}")


def split_sentences_multilingual(text: str) -> list[str]:
    """Split ``text`` into sentences across multiple languages.

    Recognised terminators: ``.`` ``!`` ``?`` ``。`` ``！`` ``？`` ``｡``.
    The terminator is kept on the preceding sentence. Decimals, version
    strings, and a small set of common abbreviations are protected from
    over-aggressive splitting. Newlines also act as sentence boundaries
    so short structural lines (headings / bullets / key:value rows) stay
    on their own.
    """
    if not text or not text.strip():
        return []

    sentences: list[str] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        sentences.extend(_split_line_sentences(line))
    return [s for s in sentences if s.strip()]


def _split_line_sentences(line: str) -> list[str]:
    """Split one line on multilingual sentence terminators."""
    out: list[str] = []
    buf: list[str] = []
    i = 0
    n = len(line)
    while i < n:
        ch = line[i]
        buf.append(ch)
        if ch in _SENT_END_CHARS and _is_sentence_break(line, i):
            j = i + 1
            # Consume trailing closing quotes / brackets.
            while j < n and line[j] in '")]}»’”':
                buf.append(line[j])
                j += 1
            # Skip whitespace after the terminator.
            while j < n and line[j].isspace():
                j += 1
            piece = "".join(buf).strip()
            if piece:
                out.append(piece)
            buf = []
            i = j
            continue
        i += 1
    if buf:
        tail = "".join(buf).strip()
        if tail:
            out.append(tail)
    return out


def _is_sentence_break(line: str, idx: int) -> bool:
    """Decide whether ``line[idx]`` is a real sentence boundary."""
    ch = line[idx]
    if ch in "。！？｡!?":
        return True
    # ch == '.'
    window = line[max(0, idx - 1) : idx + 2]
    if _NUMBER_DOT.search(window):
        return False
    # Previous-token (abbreviation) check.
    j = idx - 1
    while j >= 0 and (line[j].isalpha() or line[j] == "."):
        j -= 1
    prev_token = line[j + 1 : idx].strip(".").lower()
    if prev_token in _ABBREVIATIONS:
        return False
    if idx + 1 >= len(line):
        return True
    nxt = line[idx + 1]
    if nxt.isspace() or nxt in '")]}»’”':
        return True
    return False


def _split_clauses(text: str) -> list[str]:
    """Second-stage split: break on clause punctuation. Keeps the punct."""
    parts: list[str] = []
    buf: list[str] = []
    for ch in text:
        buf.append(ch)
        if ch in _CLAUSE_PUNCT:
            piece = "".join(buf).strip()
            if piece:
                parts.append(piece)
            buf = []
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def _is_combining(ch: str) -> bool:
    """True for common Unicode combining marks (category starts with 'M')."""
    cp = ord(ch)
    return (
        0x0300 <= cp <= 0x036F
        or 0x1AB0 <= cp <= 0x1AFF
        or 0x1DC0 <= cp <= 0x1DFF
        or 0x20D0 <= cp <= 0x20FF
        or 0xFE20 <= cp <= 0xFE2F
    )


def _hard_split(text: str, limit: int) -> list[str]:
    """Last-resort splitter for a fragment with no useful punctuation."""
    pieces: list[str] = []
    remaining = text
    while len(remaining) > limit:
        cut = remaining.rfind(" ", 0, limit)
        if cut <= limit // 2:
            cut = limit
        while cut < len(remaining) and _is_combining(remaining[cut]):
            cut += 1
        head = remaining[:cut].strip()
        if head:
            pieces.append(head)
        remaining = remaining[cut:].lstrip()
    if remaining:
        pieces.append(remaining)
    return [p for p in pieces if p]


def _split_to_size(text: str, limit: int) -> list[str]:
    """Split ``text`` so that no piece exceeds ``limit``.

    Cascades through: sentence → clause → whitespace → character.
    """
    if len(text) <= limit:
        return [text]
    out: list[str] = []
    sentences = split_sentences_multilingual(text) or [text]
    for sent in sentences:
        if len(sent) <= limit:
            out.append(sent)
            continue
        for clause in _split_clauses(sent):
            if len(clause) <= limit:
                out.append(clause)
            else:
                out.extend(_hard_split(clause, limit))
    return [p for p in out if p]


# ── Short-chunk usefulness filter ────────────────────────────────────────────

def _is_meaningful_short_chunk(chunk: str) -> bool:
    """Return True when a chunk below ``min_chunk`` still carries signal."""
    s = chunk.strip()
    if not s:
        return False
    if sum(1 for c in s if c.isalnum()) < 2:
        return False
    if _DIGIT_RE.search(s):
        return True
    if _UPPER_IDENT_RE.search(s):
        return True
    if _CJK_CYRILLIC_RE.search(s):
        return True
    # Structural patterns may appear anywhere in the chunk (overlap carry
    # can shift the bullet / heading / KV row away from the chunk start).
    if _KV_ANY_RE.search(s) or _BULLET_ANY_RE.search(s):
        return True
    for line in s.splitlines():
        ln = line.strip()
        if ln and _HEADING_RE.match(ln):
            return True
    return False


# ── Public chunker ───────────────────────────────────────────────────────────


def chunk_text(
    text: str,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = OVERLAP,
    min_chunk: int = MIN_CHUNK,
) -> list[str]:
    """Split ``text`` into overlapping chunks.

    Guarantees:
      * Returns at least one chunk if ``text`` is non-empty (after strip).
      * No chunk exceeds ``chunk_size + tolerance`` where
        ``tolerance = max(40, chunk_size // 5)``.
      * Short chunks below ``min_chunk`` are kept when they carry useful
        signal (see :func:`_is_meaningful_short_chunk`).
      * Approximately ``overlap`` characters of context are carried between
        consecutive chunks. Overlap is taken from the last sentence/clause
        boundary of the previous chunk when possible.
    """
    if not text or not text.strip():
        return []

    tolerance = max(40, chunk_size // 5)
    hard_cap = chunk_size + tolerance

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]

    # Flatten paragraphs into size-bounded segments.
    segments: list[str] = []
    for para in paragraphs:
        if len(para) <= chunk_size:
            segments.append(para)
        else:
            segments.extend(_split_to_size(para, chunk_size))

    chunks: list[str] = []
    current_parts: list[str] = []
    current_len = 0
    carry = ""

    def _flush() -> None:
        nonlocal current_parts, current_len, carry
        if not current_parts:
            return
        body = " ".join(current_parts).strip()
        if carry:
            body = (carry + "\n" + body).strip()
        if len(body) > hard_cap:
            for piece in _split_to_size(body, chunk_size):
                if piece:
                    chunks.append(piece)
            carry = _make_carry(chunks[-1], overlap) if chunks else ""
        else:
            chunks.append(body)
            carry = _make_carry(body, overlap)
        current_parts = []
        current_len = 0

    for seg in segments:
        if current_parts and current_len + len(seg) + 1 > chunk_size:
            _flush()
        if len(seg) > chunk_size:
            if current_parts:
                _flush()
            current_parts = [seg]
            current_len = len(seg)
            _flush()
            continue
        current_parts.append(seg)
        current_len += len(seg) + 1

    _flush()

    # Filter while preserving meaningful short chunks.
    filtered: list[str] = []
    for c in chunks:
        c_stripped = c.strip()
        if not c_stripped:
            continue
        if len(c_stripped) >= min_chunk or _is_meaningful_short_chunk(c_stripped):
            filtered.append(c_stripped)

    if not filtered:
        filtered = [text.strip()]

    return filtered


def _make_carry(chunk: str, overlap: int) -> str:
    """Return a clean tail of ``chunk`` (~``overlap`` chars) for context."""
    if overlap <= 0 or not chunk:
        return ""
    if len(chunk) <= overlap:
        return chunk
    tail = chunk[-overlap:]
    m = re.search(_SENT_END_CLASS + r"\s+(\S)", tail)
    if m and m.end() < len(tail):
        tail = tail[m.end() - 1 :].lstrip()
    else:
        m2 = re.search(_CLAUSE_CLASS + r"\s+(\S)", tail)
        if m2 and m2.end() < len(tail):
            tail = tail[m2.end() - 1 :].lstrip()
        else:
            sp = tail.find(" ")
            if 0 <= sp < len(tail) - 1:
                tail = tail[sp + 1 :]
    return tail.strip()


# ── Backwards compat shim ────────────────────────────────────────────────────


def _split_sentences(text: str) -> list[str]:
    """Deprecated alias kept for older imports. Use
    :func:`split_sentences_multilingual` instead."""
    return split_sentences_multilingual(text)

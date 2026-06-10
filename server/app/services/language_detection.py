"""Lightweight response-language detection and prompt helpers."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class DetectedLanguage:
    code: str
    name: str
    confidence: float
    source: str = "heuristic"


ENGLISH = DetectedLanguage("en", "English", 0.60, "fallback")

_UZBEK_MARKERS = {
    "bilan",
    "bo'lishi",
    "bo‘ladi",
    "bo‘lishi",
    "emas",
    "ham",
    "hukumat",
    "hukumatlar",
    "kerak",
    "kerakmi",
    "qanday",
    "qilish",
    "qilishi",
    "solish",
    "solishi",
    "tartibga",
    "tizim",
    "tizimlari",
    "tizimlarini",
    "uchun",
    "xavfli",
    "yuqori",
}
_ENGLISH_MARKERS = {
    "are",
    "can",
    "do",
    "does",
    "governments",
    "how",
    "is",
    "regulate",
    "should",
    "the",
    "what",
    "why",
}
_WORD_RE = re.compile(r"[A-Za-zÀ-žʻ’'-]+")


def detect_response_language(text: str) -> DetectedLanguage:
    """Detect the primary language without a network call or heavy dependency."""
    value = (text or "").strip()
    if not value:
        return ENGLISH

    letters = [ch for ch in value if ch.isalpha()]
    letter_count = max(1, len(letters))
    hangul = sum("\uac00" <= ch <= "\ud7af" or "\u1100" <= ch <= "\u11ff" for ch in letters)
    cyrillic = sum("\u0400" <= ch <= "\u04ff" for ch in letters)
    kana = sum("\u3040" <= ch <= "\u30ff" for ch in letters)
    han = sum("\u4e00" <= ch <= "\u9fff" for ch in letters)
    arabic = sum("\u0600" <= ch <= "\u06ff" for ch in letters)

    if hangul:
        return DetectedLanguage("ko", "Korean", min(0.99, 0.88 + hangul / letter_count))
    if cyrillic:
        return DetectedLanguage("ru", "Russian", min(0.98, 0.84 + cyrillic / letter_count))
    if kana:
        return DetectedLanguage("ja", "Japanese", min(0.98, 0.84 + kana / letter_count))
    if han:
        return DetectedLanguage("zh", "Chinese", min(0.96, 0.80 + han / letter_count))
    if arabic:
        return DetectedLanguage("ar", "Arabic", min(0.98, 0.84 + arabic / letter_count))

    words = [word.lower().replace("’", "'") for word in _WORD_RE.findall(value)]
    word_set = set(words)
    uzbek_hits = len(word_set & _UZBEK_MARKERS)
    english_hits = len(word_set & _ENGLISH_MARKERS)
    if uzbek_hits >= 2 or any("o'" in word or "g'" in word for word in words):
        return DetectedLanguage("uz", "Uzbek", min(0.96, 0.72 + uzbek_hits * 0.06))

    # Very short Latin-script questions such as "why?" are intentionally
    # low-confidence so follow-up resolution can inherit the previous language.
    confidence = 0.45 if len(words) <= 2 else min(0.94, 0.70 + english_hits * 0.04)
    return DetectedLanguage("en", "English", confidence)


def resolve_response_language(
    text: str,
    previous: DetectedLanguage | None = None,
    *,
    confidence_threshold: float = 0.65,
) -> DetectedLanguage:
    """Detect language, inheriting the previous cycle for ambiguous short text."""
    detected = detect_response_language(text)
    if previous is not None and detected.confidence < confidence_threshold:
        return DetectedLanguage(
            previous.code,
            previous.name,
            previous.confidence,
            "inherited",
        )
    return detected


def looks_like_language(text: str, language_code: str) -> bool:
    """Return a tolerant script-level language consistency signal."""
    value = text or ""
    letters = [ch for ch in value if ch.isalpha()]
    if not letters:
        return True
    if language_code == "ko":
        return any("\uac00" <= ch <= "\ud7af" or "\u1100" <= ch <= "\u11ff" for ch in letters)
    if language_code == "ru":
        return any("\u0400" <= ch <= "\u04ff" for ch in letters)
    if language_code == "ja":
        return any("\u3040" <= ch <= "\u30ff" for ch in letters)
    if language_code == "zh":
        return any("\u4e00" <= ch <= "\u9fff" for ch in letters)
    if language_code == "ar":
        return any("\u0600" <= ch <= "\u06ff" for ch in letters)
    # English and Uzbek both use Latin script, so avoid pretending a script
    # check can distinguish them.
    return any(ch.isascii() and ch.isalpha() for ch in letters)


def language_requirement_block(language_code: str, language_name: str) -> str:
    """Build the shared language contract embedded in every generation prompt."""
    if not language_code or not language_name:
        return ""
    return f"""LANGUAGE REQUIREMENT:
- The user's active question is in {language_name} ({language_code}).
- Write all user-visible natural-language values in {language_name}.
- Keep JSON keys exactly as specified in English.
- Do not switch to English unless the target response language is English.
- Do not translate agent names, model/provider names, URLs, code identifiers, or technical identifiers.
- Retrieved documents may be in another language. Use them as evidence, but explain their relevance in {language_name}.
- Do not copy long foreign-language passages unless necessary."""


__all__ = [
    "DetectedLanguage",
    "detect_response_language",
    "language_requirement_block",
    "looks_like_language",
    "resolve_response_language",
]

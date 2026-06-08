"""Tests for the multilingual chunker (Step 44).

These tests exercise:
  * multilingual sentence splitting (English / Korean / Japanese /
    Chinese / Russian punctuation)
  * the hard chunk-size cap (no chunk exceeds chunk_size + tolerance)
  * preservation of short-but-meaningful chunks (table rows, key-value
    facts, headings)
  * overlap behaviour
"""

from __future__ import annotations

import pytest

from app.services.documents.chunker import (
    CHUNK_SIZE,
    chunk_text,
    split_sentences_multilingual,
)


# ── Hard cap ─────────────────────────────────────────────────────────────────

class TestHardCap:
    def test_long_single_sentence_no_punctuation_is_split(self):
        # 5_000 chars of one undelimited token — must still respect the cap.
        text = "x" * 5000
        chunks = chunk_text(text, chunk_size=400, overlap=20)
        tolerance = max(40, 400 // 5)
        assert chunks, "expected at least one chunk"
        for c in chunks:
            assert len(c) <= 400 + tolerance, (
                f"chunk of {len(c)} chars exceeds hard cap {400 + tolerance}"
            )

    def test_long_sentence_with_clause_punctuation_is_split(self):
        sentence = "alpha, " * 400  # very long, only commas
        chunks = chunk_text(sentence, chunk_size=300, overlap=30)
        tolerance = max(40, 300 // 5)
        for c in chunks:
            assert len(c) <= 300 + tolerance

    def test_overlap_present_between_consecutive_chunks(self):
        text = ("This is a meaningful sentence about chunking. " * 80)
        chunks = chunk_text(text, chunk_size=400, overlap=80)
        assert len(chunks) >= 2
        # At least one consecutive pair should share a non-trivial suffix /
        # prefix overlap.
        found_overlap = False
        for prev, curr in zip(chunks, chunks[1:]):
            for k in range(20, min(80, len(prev), len(curr))):
                if prev[-k:].strip() and prev[-k:].strip() in curr[:160]:
                    found_overlap = True
                    break
            if found_overlap:
                break
        assert found_overlap, "expected some textual overlap between chunks"


# ── Multilingual splitting ───────────────────────────────────────────────────

class TestMultilingualSentenceSplit:
    def test_english(self):
        sents = split_sentences_multilingual("Hello world. How are you? Fine!")
        assert sents == ["Hello world.", "How are you?", "Fine!"]

    def test_decimal_not_split(self):
        sents = split_sentences_multilingual("Pi is about 3.14 and e is 2.71.")
        assert sents == ["Pi is about 3.14 and e is 2.71."]

    def test_abbreviation_not_split(self):
        sents = split_sentences_multilingual("Dr. Smith arrived. He waved.")
        assert sents == ["Dr. Smith arrived.", "He waved."]

    def test_russian(self):
        sents = split_sentences_multilingual(
            "Кодовое имя проекта — ORION-742. Рекомендуемый регион — asia-northeast3."
        )
        assert len(sents) == 2
        assert "ORION-742" in sents[0]
        assert "asia-northeast3" in sents[1]

    def test_korean(self):
        sents = split_sentences_multilingual(
            "프로젝트 코드명은 ORION-742입니다. 권장 배포 리전은 asia-northeast3입니다."
        )
        assert len(sents) == 2
        assert "ORION-742" in sents[0]
        assert "asia-northeast3" in sents[1]

    def test_japanese_fullwidth(self):
        sents = split_sentences_multilingual("これはテストです。質問はありますか？はい！")
        assert sents == [
            "これはテストです。",
            "質問はありますか？",
            "はい！",
        ]

    def test_chinese_fullwidth(self):
        sents = split_sentences_multilingual("项目代号是ORION-742。推荐区域是asia-northeast3。")
        assert len(sents) == 2
        assert sents[0].endswith("。")
        assert sents[1].endswith("。")

    def test_mixed_languages_one_paragraph(self):
        text = (
            "The project codename is ORION-742. "
            "프로젝트 코드명은 ORION-742입니다. "
            "项目代号是ORION-742。"
        )
        sents = split_sentences_multilingual(text)
        assert len(sents) == 3


# ── Chunking per language ────────────────────────────────────────────────────

class TestChunkingLanguages:
    def test_english_paragraphs_within_cap(self):
        text = "\n\n".join("Sentence about topic %d. " % i * 5 for i in range(30))
        chunks = chunk_text(text, chunk_size=600, overlap=50)
        tol = max(40, 600 // 5)
        assert len(chunks) >= 2
        for c in chunks:
            assert len(c) <= 600 + tol

    def test_korean_short_sentences_preserved(self):
        text = "프로젝트 코드명은 ORION-742입니다.\n권장 배포 리전은 asia-northeast3입니다."
        chunks = chunk_text(text, chunk_size=600, overlap=50, min_chunk=80)
        joined = " ".join(chunks)
        assert "ORION-742" in joined
        assert "asia-northeast3" in joined

    def test_japanese_chinese_splits(self):
        text = (
            "项目代号是ORION-742。" * 30
            + "\n\n"
            + "プロジェクトコード名はORION-742です。" * 30
        )
        chunks = chunk_text(text, chunk_size=400, overlap=30)
        tol = max(40, 400 // 5)
        for c in chunks:
            assert len(c) <= 400 + tol

    def test_russian_paragraphs(self):
        text = (
            "Кодовое имя проекта — ORION-742. "
            "Рекомендуемый регион развертывания — asia-northeast3. "
        ) * 40
        chunks = chunk_text(text, chunk_size=500, overlap=50)
        tol = max(40, 500 // 5)
        for c in chunks:
            assert len(c) <= 500 + tol
        assert any("ORION-742" in c for c in chunks)


# ── Short meaningful chunks ──────────────────────────────────────────────────

class TestShortMeaningfulChunks:
    def test_key_value_row_preserved(self):
        # A short trailing line below MIN_CHUNK should survive because it
        # carries a key:value fact.
        big = "Filler sentence. " * 50  # forces a first chunk
        text = big + "\n\nRegion: asia-northeast3"
        chunks = chunk_text(text, chunk_size=400, overlap=30, min_chunk=80)
        assert any("asia-northeast3" in c for c in chunks)

    def test_identifier_preserved(self):
        big = "Filler sentence. " * 50
        text = big + "\n\nORION-742"
        chunks = chunk_text(text, chunk_size=400, overlap=30, min_chunk=80)
        assert any("ORION-742" in c for c in chunks)

    def test_short_korean_line_preserved(self):
        big = "Filler sentence. " * 50
        text = big + "\n\n한국어"
        chunks = chunk_text(text, chunk_size=400, overlap=30, min_chunk=80)
        assert any("한국어" in c for c in chunks)

    def test_whitespace_only_dropped(self):
        big = "Filler sentence. " * 50
        text = big + "\n\n   \n\n"
        chunks = chunk_text(text, chunk_size=400, overlap=30, min_chunk=80)
        assert all(c.strip() for c in chunks)

    def test_bullet_line_preserved(self):
        big = "Filler sentence. " * 50
        text = big + "\n\n- key fact"
        chunks = chunk_text(text, chunk_size=400, overlap=30, min_chunk=80)
        assert any("key fact" in c for c in chunks)


# ── API compatibility ───────────────────────────────────────────────────────

class TestApiCompat:
    def test_default_args_still_work(self):
        # DocumentIngestionService calls chunk_text(text) with defaults.
        assert chunk_text("Hello world.") == ["Hello world."]
        assert chunk_text("") == []

    def test_returns_list_of_str(self):
        out = chunk_text("alpha. beta. gamma.", chunk_size=20)
        assert isinstance(out, list)
        assert all(isinstance(x, str) for x in out)


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-v"])

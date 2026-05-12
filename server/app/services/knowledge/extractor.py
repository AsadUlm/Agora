"""
Knowledge extraction service (Step 31).

Single LLM call per document. Compressed sampling keeps the input ~3.5k chars
regardless of document size. Output is a JSON blob with topics, claims,
entities, risk domains, document type, and a short summary.

The service is intentionally robust:
  * Any failure (LLM unavailable, JSON parse error, etc.) returns
    ``empty_metadata(status="failed", error=...)`` instead of raising.
  * The caller (ingestion service) treats knowledge extraction as best-effort
    and never lets it block document.status=ready.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Iterable

from app.schemas.contracts import LLMRequest, LLMResponse
from app.services.knowledge.schemas import (
    DOCUMENT_TYPES,
    KnowledgeMetadata,
    empty_metadata,
)
from app.services.llm.parser import parse_json_from_llm
from app.services.llm.service import LLMService

logger = logging.getLogger(__name__)

# Hard caps — keep extraction prompt + output ≪ 4k tokens.
_MAX_SAMPLE_CHARS = 3500
_MAX_RESPONSE_TOKENS = 700
_DEFAULT_TEMPERATURE = 0.1
_TARGET_TOPICS = 6
_TARGET_CLAIMS = 8
_TARGET_ENTITIES = 10
_TARGET_RISK_DOMAINS = 4


# ── Compressed sampling ──────────────────────────────────────────────────────


def compress_chunks_for_extraction(
    chunks: Iterable[str],
    *,
    max_chars: int = _MAX_SAMPLE_CHARS,
    head_chunks: int = 3,
    spaced_chunks: int = 3,
    tail_chunks: int = 1,
) -> str:
    """Build a representative sample from chunked text.

    Strategy:
      1. Always include the first ``head_chunks`` (intro / abstract).
      2. Pick ``spaced_chunks`` evenly spaced from the middle.
      3. Always include the last ``tail_chunks`` (conclusion).
      4. Hard-cap total characters at ``max_chars`` — overflow is dropped.

    The result preserves narrative structure while staying small enough for
    a single cheap LLM call.
    """
    chunk_list = [c for c in chunks if c and c.strip()]
    if not chunk_list:
        return ""

    n = len(chunk_list)
    selected_indices: list[int] = []

    for i in range(min(head_chunks, n)):
        selected_indices.append(i)

    if n > head_chunks + tail_chunks and spaced_chunks > 0:
        middle_start = head_chunks
        middle_end = n - tail_chunks
        if middle_end > middle_start:
            step = max(1, (middle_end - middle_start) // (spaced_chunks + 1))
            for i in range(1, spaced_chunks + 1):
                idx = middle_start + step * i
                if middle_start <= idx < middle_end:
                    selected_indices.append(idx)

    for i in range(max(0, n - tail_chunks), n):
        if i not in selected_indices:
            selected_indices.append(i)

    selected_indices = sorted(set(selected_indices))

    pieces: list[str] = []
    used = 0
    for idx in selected_indices:
        chunk = chunk_list[idx].strip()
        remaining = max_chars - used
        if remaining <= 0:
            break
        if len(chunk) > remaining:
            chunk = chunk[: remaining - 1].rstrip() + "…"
        pieces.append(f"[chunk {idx + 1}/{n}]\n{chunk}")
        used += len(chunk) + 20  # overhead for the header

    return "\n\n".join(pieces)


# ── Claim post-processing ────────────────────────────────────────────────────


_TOKEN_RE = re.compile(r"\w+", re.UNICODE)


def _tokens(text: str) -> set[str]:
    return {t.lower() for t in _TOKEN_RE.findall(text or "") if len(t) > 2}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def deduplicate_claims(
    claims: Iterable[str],
    *,
    similarity_threshold: float = 0.6,
    max_claims: int = _TARGET_CLAIMS,
) -> list[str]:
    """Drop near-duplicate claims using token-set Jaccard similarity.

    Preserves order — first occurrence wins. Bounded by ``max_claims``.
    """
    seen: list[tuple[str, set[str]]] = []
    for claim in claims:
        if not isinstance(claim, str):
            continue
        norm = claim.strip()
        if len(norm) < 20 or len(norm) > 400:
            # Too short → not a real claim; too long → likely a paragraph.
            continue
        toks = _tokens(norm)
        if not toks:
            continue
        if any(_jaccard(toks, prev_toks) >= similarity_threshold for _, prev_toks in seen):
            continue
        seen.append((norm, toks))
        if len(seen) >= max_claims:
            break
    return [c for c, _ in seen]


# Heuristic importance signals — applied AFTER LLM extraction to re-rank claims
# without spending another LLM call.
_IMPORTANCE_KEYWORDS = (
    "increase", "decrease", "reduce", "cause", "leads to", "results in",
    "tradeoff", "trade-off", "however", "although", "constraint", "limit",
    "regulation", "policy", "license", "license", "enforce", "fail", "failure",
    "risk", "harm", "benefit", "cost", "impact", "consequence", "evidence",
    "study", "data", "percent", "%",
)


def score_claim_importance(claim: str) -> float:
    """Lightweight importance score in [0.0, 1.0].

    Higher scores prefer:
      - claims with concrete numbers (statistics);
      - claims with causal/policy verbs;
      - mid-length claims (40–200 chars).
    """
    if not claim:
        return 0.0
    text = claim.strip()
    if not text:
        return 0.0

    score = 0.0
    lower = text.lower()

    # Length sweet spot
    n = len(text)
    if 40 <= n <= 200:
        score += 0.4
    elif 20 <= n <= 320:
        score += 0.2

    # Keyword signals
    hit_count = sum(1 for kw in _IMPORTANCE_KEYWORDS if kw in lower)
    score += min(hit_count * 0.1, 0.4)

    # Numerals — strong signal of empirical content.
    if re.search(r"\d", text):
        score += 0.2

    return min(score, 1.0)


def rank_claims_by_importance(claims: list[str], *, top_k: int = _TARGET_CLAIMS) -> list[str]:
    if not claims:
        return []
    scored = sorted(
        ((score_claim_importance(c), i, c) for i, c in enumerate(claims)),
        key=lambda t: (-t[0], t[1]),
    )
    return [c for _, _, c in scored[:top_k]]


# ── Prompt ───────────────────────────────────────────────────────────────────


_SYSTEM_PROMPT = """You are a knowledge extraction system for a deliberation platform.
Read the supplied document excerpts and produce a STRICT JSON object that
catalogues the document's semantic content for downstream retrieval.

Rules:
- Output ONLY a single JSON object, no prose, no markdown fences.
- Every field is required; use empty arrays / empty strings if unknown.
- Keep arrays SHORT and high-signal (max ~6 items each).
- Claims must be concise, evidence-bearing, and self-contained — NEVER vague.
- Prefer claims that express tradeoffs, mechanisms, or measurable effects.
- Topics are 1–4 word noun phrases. Entities are proper nouns or organizations.
- risk_domains lists ONLY the failure / harm domains the document discusses.
- document_type MUST be one of: """ + ", ".join(DOCUMENT_TYPES) + """."""


_USER_PROMPT_TEMPLATE = """Document filename: {filename}
File extension: {source_type}

DOCUMENT EXCERPTS (representative sample):
---
{sample}
---

Produce JSON with this exact shape:
{{
  "document_type": "<one of the allowed types>",
  "summary": "<2–4 sentences>",
  "main_topics": ["..."],
  "key_claims": ["..."],
  "key_entities": ["..."],
  "risk_domains": ["..."]
}}"""


# ── Service ──────────────────────────────────────────────────────────────────


class KnowledgeExtractionService:
    """Single-call LLM extractor producing structured semantic metadata.

    Stateless. Inject a `LLMService` for the call. The provider/model used for
    extraction can be different from the debate agents' provider/model.
    """

    def __init__(
        self,
        llm: LLMService | None = None,
        *,
        provider: str | None = None,
        model: str | None = None,
        temperature: float = _DEFAULT_TEMPERATURE,
        max_tokens: int = _MAX_RESPONSE_TOKENS,
    ) -> None:
        self._llm = llm
        self._provider = provider
        self._model = model
        self._temperature = temperature
        self._max_tokens = max_tokens

    async def extract(
        self,
        chunks: list[str],
        *,
        filename: str = "",
        source_type: str = "",
    ) -> KnowledgeMetadata:
        """Run knowledge extraction over ``chunks``.

        Returns ``empty_metadata`` (with extraction_status reflecting the
        outcome) on any failure. Never raises.
        """
        sample = compress_chunks_for_extraction(chunks)
        if not sample:
            return empty_metadata(status="skipped", error="empty_sample")

        if self._llm is None:
            try:
                from app.services.llm.service import get_llm_service  # noqa: PLC0415
                self._llm = get_llm_service()
            except Exception as exc:  # noqa: BLE001
                logger.warning("knowledge_extraction_llm_unavailable: %s", exc)
                return empty_metadata(status="failed", error=f"llm_unavailable: {exc}")

        prompt = _USER_PROMPT_TEMPLATE.format(
            filename=filename or "(unknown)",
            source_type=source_type or "(unknown)",
            sample=sample,
        )
        full_prompt = _SYSTEM_PROMPT + "\n\n" + prompt

        provider = self._provider or self._llm.__class__.__name__.lower()
        model = self._model or "default"

        request = LLMRequest(
            provider=provider,
            model=model,
            prompt=full_prompt,
            temperature=self._temperature,
            max_tokens=self._max_tokens,
        )

        try:
            response: LLMResponse = await self._llm.generate(request)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "knowledge_extraction_call_failed filename=%s reason=%s",
                filename, exc,
            )
            return empty_metadata(status="failed", error=f"llm_call: {exc}")

        try:
            payload = parse_json_from_llm(response.content)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "knowledge_extraction_parse_failed filename=%s reason=%s",
                filename, exc,
            )
            return empty_metadata(status="failed", error=f"parse: {exc}")

        return self._normalize_payload(payload)

    # ── helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _normalize_payload(payload: dict[str, Any]) -> KnowledgeMetadata:
        """Coerce raw LLM JSON into a clean KnowledgeMetadata object."""
        if not isinstance(payload, dict):
            return empty_metadata(status="failed", error="payload_not_object")

        document_type = str(payload.get("document_type") or "unknown").lower()
        if document_type not in DOCUMENT_TYPES:
            document_type = "unknown"

        summary = str(payload.get("summary") or "").strip()
        if len(summary) > 800:
            summary = summary[:799].rstrip() + "…"

        main_topics = _clean_list(payload.get("main_topics"), max_items=_TARGET_TOPICS, max_len=80)
        key_entities = _clean_list(payload.get("key_entities"), max_items=_TARGET_ENTITIES, max_len=80)
        risk_domains = _clean_list(payload.get("risk_domains"), max_items=_TARGET_RISK_DOMAINS, max_len=80)

        raw_claims = _clean_list(payload.get("key_claims"), max_items=20, max_len=400)
        deduped = deduplicate_claims(raw_claims)
        ranked_claims = rank_claims_by_importance(deduped, top_k=_TARGET_CLAIMS)

        return KnowledgeMetadata(
            document_type=document_type,
            summary=summary,
            main_topics=main_topics,
            key_claims=ranked_claims,
            key_entities=key_entities,
            risk_domains=risk_domains,
            extraction_status="ok",
            extraction_error=None,
        )


def _clean_list(value: Any, *, max_items: int, max_len: int) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            continue
        s = " ".join(item.split()).strip()
        if not s:
            continue
        if len(s) > max_len:
            s = s[: max_len - 1].rstrip() + "…"
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
        if len(out) >= max_items:
            break
    return out

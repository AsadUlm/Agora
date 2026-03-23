"""Quick smoke test for the refactored LLM layer. Run from server/ directory."""

import asyncio
import json
import sys

from app.services.llm.utils.parser import extract_json
from app.services.llm.providers.mock_provider import MockProvider
from app.services.llm.service import LLMService


def test_parser():
    plain = json.dumps({"stance": "test", "confidence": 0.9, "key_points": []})
    fenced = "```json\n" + plain + "\n```"
    embedded = "Some text before { " + plain[1:] + " some text after"

    result, err = extract_json(plain)
    assert result["stance"] == "test", f"plain parse failed: {result}"
    assert err is None

    result, err = extract_json(fenced)
    assert result["stance"] == "test", f"fence strip failed: {result}"

    result, err = extract_json("garbage not json")
    assert result == {}, f"garbage should return empty dict: {result}"
    assert err is not None

    print("  [OK] parser: plain JSON")
    print("  [OK] parser: markdown-fenced JSON")
    print("  [OK] parser: garbage input returns empty dict + error")


async def test_mock_service():
    svc = LLMService(provider=MockProvider())

    r1 = await svc.generate_structured("opening statement round 1 key_points confidence")
    assert "stance" in r1, f"Round 1 missing 'stance': {r1}"
    assert "key_points" in r1
    assert "confidence" in r1
    print("  [OK] MockProvider: Round 1 opening statement")

    r2 = await svc.generate_structured("cross-examination round 2 challenge rebuttal")
    assert "challenge" in r2, f"Round 2 missing 'challenge': {r2}"
    assert "response" in r2
    assert "rebuttal" in r2
    print("  [OK] MockProvider: Round 2 cross-examination")

    r3 = await svc.generate_structured("final synthesis round 3 what_changed recommendation")
    assert "final_stance" in r3, f"Round 3 missing 'final_stance': {r3}"
    assert "what_changed" in r3
    assert "remaining_concerns" in r3
    assert "recommendation" in r3
    print("  [OK] MockProvider: Round 3 final synthesis")


async def main():
    print("\n=== LLM Layer Smoke Tests ===\n")
    print("Parser:")
    test_parser()

    print("\nMock provider via LLMService:")
    await test_mock_service()

    print("\n=== ALL TESTS PASSED ===\n")


if __name__ == "__main__":
    asyncio.run(main())

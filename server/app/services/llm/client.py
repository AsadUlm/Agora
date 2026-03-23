"""
app/services/llm/client.py — DEPRECATED shim.

This file is kept only for backwards compatibility.
All new code must import from app.services.llm.service directly:

    from app.services.llm.service import get_llm_service

The round modules (round1.py, round2.py, round3.py) have been updated
to use LLMService directly and no longer call generate() from here.
"""

import json
import logging

from app.services.llm.service import get_llm_service

logger = logging.getLogger(__name__)


async def generate(prompt: str) -> str:
    """
    Deprecated shim — delegates to LLMService.generate_structured().

    Returns a JSON string (not a dict) so callers that relied on the old
    interface continue to work without modification.
    """
    logger.warning(
        "app.services.llm.client.generate() is deprecated. "
        "Use LLMService.generate_structured() instead."
    )
    service = get_llm_service()
    result = await service.generate_structured(prompt)
    return json.dumps(result)

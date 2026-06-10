"""Lifecycle-specific exceptions and helpers for debate execution."""

from __future__ import annotations

from app.schemas.contracts import AgentRoundResult
from app.services.llm.provider_error_classifier import (
    FINAL_SYNTHESIS_FAILED,
    ROUND_ALL_AGENTS_FAILED,
    DebateSafeError,
    make_safe_error,
)


class FinalSynthesisFailed(RuntimeError):
    """Final synthesis failed after usable agent-stage output was persisted."""

    def __init__(
        self,
        message: str,
        *,
        results: list[AgentRoundResult],
        request_id: str,
        last_successful_stage: int = 4,
    ) -> None:
        super().__init__(message)
        successful = [r.role for r in results if r.generation_status == "success"]
        failed = [r.role for r in results if r.generation_status != "success"]
        self.safe_error: DebateSafeError = make_safe_error(
            FINAL_SYNTHESIS_FAILED,
            message=message,
            round_number=5,
            round_type="final",
            severity="partial",
            phase="final_synthesis",
            failed_agents=failed,
            successful_agents=successful,
            partial_results_available=True,
            request_id=request_id,
            last_successful_stage=last_successful_stage,
        )


class RequiredStageFailed(RuntimeError):
    """Every required agent failed, so execution cannot continue."""

    def __init__(
        self,
        message: str,
        *,
        results: list[AgentRoundResult],
        stage: int,
        phase: str,
        request_id: str,
        error_code: str = ROUND_ALL_AGENTS_FAILED,
    ) -> None:
        super().__init__(message)
        self.safe_error = make_safe_error(
            error_code,
            message=message,
            round_number=stage,
            round_type=phase,
            severity="fatal",
            phase=phase,
            failed_agents=[r.role for r in results if r.generation_status != "success"],
            successful_agents=[r.role for r in results if r.generation_status == "success"],
            partial_results_available=False,
            request_id=request_id,
            last_successful_stage=max(0, stage - 1),
        )

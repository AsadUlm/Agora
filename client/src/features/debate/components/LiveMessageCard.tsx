import type { AgentRoundResult, GenerationStatus, RoundType } from "../../../types/debate";
import type { LiveMessage } from "../../../types/ws";
import AgentOutput from "./AgentOutput";

// ── Helpers ───────────────────────────────────────────────────────────

function roundNumberToType(n: number): RoundType {
    if (n === 1) return "initial";
    if (n === 2) return "critique";
    return "final";
}

function parseContent(content: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(content);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        // fall through
    }
    return { raw_content: content };
}

// ── Component ─────────────────────────────────────────────────────────

interface Props {
    message: LiveMessage;
}

/**
 * Renders a single live message by adapting LiveMessage → AgentRoundResult
 * and delegating to the existing AgentOutput component.
 */
export default function LiveMessageCard({ message }: Props) {
    const structured = parseContent(message.content);

    const result: AgentRoundResult = {
        agent_id: message.agentId,
        role: message.role || "Agent",
        content: message.content,
        structured,
        generation_status: (message.generationStatus ?? "success") as GenerationStatus,
        error: null,
    };

    return (
        <AgentOutput
            result={result}
            roundType={roundNumberToType(message.roundNumber)}
        />
    );
}

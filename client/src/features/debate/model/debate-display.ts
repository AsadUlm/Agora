export interface AgentDisplayInfo {
    displayName: string;
}

/**
 * Replaces moderator-facing generic labels without mutating persisted payloads.
 * Supports "Agent 1", lowercase variants, and straight/curly possessives.
 */
export function replaceGenericAgentLabels(
    value: string,
    agents: AgentDisplayInfo[],
): string {
    if (!value || agents.length === 0) return value;

    return value.replace(
        /\bAgent\s+(\d+)(['’]s)?\b/gi,
        (match, rawIndex: string, possessive: string | undefined) => {
            const agent = agents[Number(rawIndex) - 1];
            if (!agent?.displayName) return match;
            return `${agent.displayName}${possessive ?? ""}`;
        },
    );
}

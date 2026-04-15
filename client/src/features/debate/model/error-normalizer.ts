/**
 * Error Normalization — detects and normalizes backend/LLM error payloads
 * so they don't pollute graph inference or moderator feed.
 */

// ── Patterns that indicate a provider/API error, not real reasoning ──

const ERROR_PATTERNS = [
    /^\s*\{?\s*"error"/i,
    /HTTP\s*\d{3}/i,
    /status[_\s]?code[:\s]*[45]\d{2}/i,
    /\b(403|401|429|500|502|503)\b.*\b(forbidden|unauthorized|rate.?limit|internal.?server|bad.?gateway|service.?unavailable)\b/i,
    /\b(forbidden|unauthorized|rate.?limit|internal.?server|bad.?gateway|service.?unavailable)\b.*\b(403|401|429|500|502|503)\b/i,
    /provider\s*(error|fail)/i,
    /api[_\s]?(key|error|fail)/i,
    /openai\s*(error|exception)/i,
    /anthropic\s*(error|exception)/i,
    /model\s*(not\s*found|unavailable|error)/i,
    /quota\s*(exceeded|error)/i,
    /rate\s*limit/i,
    /authentication\s*(fail|error)/i,
    /connection\s*(refused|reset|timeout)/i,
    /Error:\s*(Failed to|Could not|Unable to)/i,
];

// Fields in WS/message payload that hint at error content
const ERROR_PAYLOAD_KEYS = ["error", "error_message", "error_code", "detail"];

export interface NormalizedError {
    isError: true;
    agentId: string | null;
    agentRole: string | null;
    errorType: "provider" | "auth" | "rate_limit" | "unknown";
    message: string;
    originalPayload: Record<string, unknown>;
}

/**
 * Check if a WS event payload or message represents an error rather than real reasoning.
 */
export function isErrorPayload(payload: Record<string, unknown>): boolean {
    // Check explicit error fields
    for (const key of ERROR_PAYLOAD_KEYS) {
        if (payload[key] !== undefined && payload[key] !== null) return true;
    }

    // Check content/text fields against error patterns
    const content = String(payload["content"] ?? payload["text"] ?? payload["reasoning"] ?? "");
    if (!content) return false;

    return ERROR_PATTERNS.some((p) => p.test(content));
}

/**
 * Check if a raw message text represents an error.
 */
export function isErrorText(text: string | null | undefined): boolean {
    if (!text) return false;
    return ERROR_PATTERNS.some((p) => p.test(text));
}

/**
 * Normalize an error payload into a structured error object.
 */
export function normalizeAgentError(
    payload: Record<string, unknown>,
    agentId: string | null = null,
    agentRole: string | null = null,
): NormalizedError {
    const errorMsg =
        typeof payload["error"] === "string"
            ? payload["error"]
            : typeof payload["error_message"] === "string"
                ? payload["error_message"]
                : typeof payload["detail"] === "string"
                    ? payload["detail"]
                    : String(payload["content"] ?? payload["text"] ?? "Unknown error");

    let errorType: NormalizedError["errorType"] = "unknown";
    const lower = errorMsg.toLowerCase();
    if (/403|forbidden|auth|unauthorized|401/.test(lower)) errorType = "auth";
    else if (/429|rate.?limit|quota/.test(lower)) errorType = "rate_limit";
    else if (/provider|api|openai|anthropic|model|connection/.test(lower)) errorType = "provider";

    return {
        isError: true,
        agentId,
        agentRole,
        errorType,
        message: errorMsg,
        originalPayload: payload,
    };
}

/**
 * Determine if a message should be skipped for graph edge inference.
 */
export function shouldSkipGraphInference(payload: Record<string, unknown>): boolean {
    return isErrorPayload(payload);
}

/**
 * Generate a clean moderator-facing error message.
 */
export function formatModeratorError(
    agentRole: string | null,
    errorType: NormalizedError["errorType"],
): string {
    const name = agentRole ?? "Agent";
    switch (errorType) {
        case "auth":
            return `${name} failed to generate a response (authentication error).`;
        case "rate_limit":
            return `${name} was rate-limited by the provider. Response skipped.`;
        case "provider":
            return `${name} failed to generate a response (provider error).`;
        default:
            return `${name} failed to generate a response.`;
    }
}

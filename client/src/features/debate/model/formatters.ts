/**
 * Content formatters — clean up raw JSON, extract readable text from agent messages,
 * and produce structured moderator activity entries.
 */

// ── Agent Message Formatter ──────────────────────────────────────────

export interface FormattedMessage {
    /** Primary display text (stance, summary, or cleaned content) */
    text: string;
    /** Key-value fields extracted from payload */
    fields: { label: string; value: string }[];
}

/**
 * Extract human-readable text from a raw agent message (which may be
 * JSON-encoded payload, raw text, or a mix).
 */
export function formatAgentMessage(raw: string | undefined | null): FormattedMessage {
    if (!raw) return { text: "", fields: [] };

    const str = String(raw).trim();
    if (!str) return { text: "", fields: [] };

    const parsed = safeParse(str);
    if (parsed) return formatPayloadObject(parsed);

    // Not JSON — return cleaned text
    return { text: cleanText(str), fields: [] };
}

/**
 * Format a payload object (already parsed) into readable text.
 */
export function formatPayloadObject(obj: Record<string, unknown>): FormattedMessage {
    const fields: { label: string; value: string }[] = [];
    let primary = "";

    // Priority order for primary text
    const primaryKeys = [
        "short_summary",
        "final_stance",
        "final_position",
        "stance",
        "summary",
        "position",
        "response",
        "text",
        "argument",
    ];
    for (const key of primaryKeys) {
        if (typeof obj[key] === "string" && (obj[key] as string).trim()) {
            primary = cleanText(obj[key] as string);
            break;
        }
    }

    // Extract notable fields for display
    const fieldKeys: Record<string, string> = {
        short_summary: "Short Summary",
        final_stance: "Final Stance",
        final_position: "Final Position",
        stance: "Stance",
        main_argument: "Main Argument",
        summary: "Summary",
        position: "Position",
        reasoning: "Reasoning",
        critique: "Critique",
        challenges: "Challenges",
        weakness_found: "Weakness Found",
        counterargument: "Counterargument",
        supports: "Supports",
        key_points: "Key Points",
        risks_or_caveats: "Risks / Caveats",
        what_changed: "What Changed",
        remaining_concerns: "Remaining Concerns",
        response: "Response",
        recommendations: "Recommendations",
        conclusion: "Conclusion",
    };

    for (const [key, label] of Object.entries(fieldKeys)) {
        const val = obj[key];
        if (val === undefined || val === null) continue;
        if (typeof val === "string" && val.trim()) {
            fields.push({ label, value: cleanText(val) });
        } else if (Array.isArray(val)) {
            const items = val
                .map((v) => (typeof v === "string" ? v : typeof v === "object" && v ? extractFirstString(v as Record<string, unknown>) : String(v)))
                .filter(Boolean);
            if (items.length > 0) {
                fields.push({ label, value: items.join("; ") });
            }
        }
    }

    // If no primary found, try first string value from payload
    if (!primary) {
        for (const val of Object.values(obj)) {
            if (typeof val === "string" && val.trim().length > 10) {
                primary = cleanText(val);
                break;
            }
        }
    }

    // Last resort: stringify
    if (!primary && fields.length === 0) {
        primary = cleanText(JSON.stringify(obj));
    }

    return { text: primary, fields };
}

// ── Moderator Activity Formatter ─────────────────────────────────────

export interface FormattedActivity {
    title: string;
    description: string;
    type: "info" | "critique" | "support" | "system" | "synthesis";
}

/**
 * Format a raw moderator event / agent message into a clean
 * human-readable activity entry.
 */
export function formatModeratorEvent(
    agentRole: string | null | undefined,
    messageContent: string | null | undefined,
    messageType: string | null | undefined,
    round: number,
): FormattedActivity {
    const role = capitalizeRole(agentRole);

    // Parse content to understand the nature of the message
    const parsed = messageContent ? safeParse(messageContent) : null;

    // Round 1: initial proposals
    if (round === 1) {
        const stance = extractStance(parsed, messageContent);
        return {
            title: `${role} presented initial position`,
            description: stance ? truncate(stance, 120) : "Shared their opening argument",
            type: "info",
        };
    }

    // Round 2: critiques / interactions
    if (round === 2) {
        if (messageType === "critique" || hasCritiques(parsed)) {
            const target = extractCritiqueTarget(parsed);
            return {
                title: target
                    ? `${role} challenged ${capitalizeRole(target)}'s position`
                    : `${role} offered a critique`,
                description: extractCritiqueSummary(parsed, messageContent),
                type: "critique",
            };
        }
        return {
            title: `${role} presented a refined argument`,
            description: extractStance(parsed, messageContent) || "Updated their position",
            type: "support",
        };
    }

    // Round 3: synthesis / final
    if (round === 3) {
        const stance = extractStance(parsed, messageContent);
        return {
            title: `${role} contributed to synthesis`,
            description: stance ? truncate(stance, 120) : "Provided final perspective",
            type: "synthesis",
        };
    }

    // Fallback
    return {
        title: `${role} responded`,
        description: extractStance(parsed, messageContent) || "Message received",
        type: "info",
    };
}

// ── Round-specific summary formatters ────────────────────────────────

/**
 * Round 1: extract a short opening stance.
 */
export function formatRound1Summary(raw: string | undefined | null): string {
    if (!raw) return "";
    const parsed = safeParse(raw);
    const response = extractPrimaryResponse(parsed, raw);
    const summary = extractShortSummary(parsed) || extractStance(parsed, null) || deriveSummaryFromText(response, 180);
    return truncate(summary, 180);
}

/**
 * Round 2: produce a human-readable critique / challenge / support sentence.
 * e.g. "Challenges Analyst's assumption about regulation flexibility"
 */
export function formatRound2Summary(
    raw: string | undefined | null,
    _sourceRole?: string | null,
    targetRole?: string | null,
): string {
    if (!raw) return "";
    const parsed = safeParse(raw);

    const shortSummary = extractShortSummary(parsed);
    if (shortSummary) {
        return truncate(shortSummary, 180);
    }

    // Try structured critique extraction
    if (parsed) {
        const target = targetRole || extractCritiqueTarget(parsed);
        const tName = capitalizeRole(target);

        if (hasCritiques(parsed)) {
            const summary = extractCritiqueSummary(parsed, null);
            return target
                ? `Challenges ${tName}: "${truncate(summary, 120)}"`
                : truncate(summary, 180);
        }

        // Check for question/inquiry patterns
        const text = extractStance(parsed, null) || "";
        const lower = text.toLowerCase();
        if (lower.includes("question") || lower.includes("how can") || lower.includes("inquir")) {
            return target
                ? `Questions ${tName}: "${truncate(text, 120)}"`
                : truncate(text, 180);
        }

        // Support / agreement
        if (lower.includes("agree") || lower.includes("support") || lower.includes("builds on")) {
            return target
                ? `Supports ${tName}: "${truncate(text, 120)}"`
                : truncate(text, 180);
        }

        // Generic with target
        if (target && text) {
            return `Responds to ${tName}: "${truncate(text, 120)}"`;
        }
        if (text) return truncate(text, 180);
    }

    return deriveSummaryFromText(cleanText(String(raw)), 180);
}

/**
 * Round 3 / synthesis: extract a clean final conclusion sentence.
 */
export function formatFinalSummary(raw: string | undefined | null): string {
    if (!raw) return "";
    const parsed = safeParse(raw);
    const shortSummary = extractShortSummary(parsed);
    if (shortSummary) return truncate(shortSummary, 200);

    if (parsed) {
        for (const key of ["final_position", "final_stance", "conclusion", "recommendation", "summary", "stance", "text"]) {
            if (typeof parsed[key] === "string" && (parsed[key] as string).trim()) {
                return truncate((parsed[key] as string).trim(), 200);
            }
        }
    }
    return deriveSummaryFromText(cleanText(String(raw)), 200);
}

/**
 * Readable summary for node cards and compact side summaries.
 */
export function getTurnSummary(args: {
    raw: string | undefined | null;
    round: number;
    kind?: string;
    sourceRole?: string | null;
    targetRole?: string | null;
    maxLen?: number;
}): string {
    const { raw, round, kind, sourceRole, targetRole, maxLen = 140 } = args;
    let summary = "";

    if (round === 1) {
        summary = formatRound1Summary(raw);
    } else if (round === 2 || kind === "intermediate") {
        summary = formatRound2Summary(raw, sourceRole, targetRole);
    } else if (round === 3 || kind === "synthesis") {
        summary = formatFinalSummary(raw);
    } else {
        summary = truncate(cleanText(String(raw ?? "")), maxLen);
    }

    return truncate(summary, maxLen);
}

/**
 * Extract the full content in a structured, readable manner for the detail panel.
 * Returns sections instead of dumping raw JSON.
 */
export interface ContentSection {
    heading: string;
    body: string;
}

export function extractStructuredContent(
    raw: string | undefined | null,
    round?: number,
    kind?: string,
): ContentSection[] {
    if (!raw) return [];
    const rawText = String(raw);
    const parsed = safeParse(rawText);
    if (!parsed) {
        const markdownSections = parseMarkdownSections(rawText);
        if (markdownSections.length > 0) return markdownSections;

        const cleaned = cleanText(rawText);
        if (!cleaned) return [];

        const paragraphs = splitParagraphs(cleaned);
        if (paragraphs.length <= 1) {
            return [{ heading: "Response", body: cleaned }];
        }

        return [
            { heading: "Main Point", body: paragraphs[0] },
            ...paragraphs.slice(1, 3).map((p, i) => ({ heading: `Detail ${i + 1}`, body: p })),
        ];
    }

    const sections: ContentSection[] = [];
    const isRound1 = round === 1;
    const isRound2 = round === 2 || kind === "intermediate";
    const isRound3 = round === 3 || kind === "synthesis";

    const sectionMap = isRound1
        ? {
            short_summary: "Short Summary",
            stance: "Stance",
            main_argument: "Main Argument",
            key_points: "Key Points",
            risks_or_caveats: "Risks / Caveats",
            response: "Full Response",
            text: "Full Response",
        }
        : isRound2
            ? {
                short_summary: "Short Summary",
                target_role: "Target",
                target_agent: "Target",
                challenge: "Challenge",
                weakness_found: "Weakness Found",
                weakness: "Weakness Found",
                counterargument: "Counterargument",
                counter_evidence: "Counterargument",
                response: "Full Response",
                text: "Full Response",
            }
            : isRound3
                ? {
                    short_summary: "Short Summary",
                    final_stance: "Final Position",
                    final_position: "Final Position",
                    what_changed: "What Changed",
                    remaining_concerns: "Remaining Concerns",
                    recommendation: "Conclusion",
                    conclusion: "Conclusion",
                    response: "Full Response",
                    text: "Full Response",
                }
                : {
                    short_summary: "Short Summary",
                    stance: "Position",
                    final_stance: "Final Stance",
                    summary: "Summary",
                    position: "Position",
                    reasoning: "Reasoning",
                    argument: "Argument",
                    conclusion: "Conclusion",
                    recommendations: "Recommendations",
                    key_points: "Key Points",
                    critique: "Critique",
                    challenge: "Challenge",
                    response: "Response",
                    text: "Response",
                };

    for (const [key, heading] of Object.entries(sectionMap)) {
        const val = parsed[key];
        if (val === undefined || val === null) continue;
        if (typeof val === "string" && val.trim()) {
            sections.push({ heading, body: cleanText(val) });
        } else if (Array.isArray(val)) {
            const items = val
                .map((v) => {
                    if (typeof v === "string") return v;
                    if (typeof v === "object" && v !== null) {
                        const obj = v as Record<string, unknown>;
                        // Format critique objects: target_role + challenge
                        const target = obj["target_role"] ?? obj["target_agent"];
                        const challenge = obj["challenge"] ?? obj["critique"] ?? obj["text"];
                        if (target && challenge) return `${capitalizeRole(String(target))}: ${challenge}`;
                        return cleanText(extractFirstString(obj as Record<string, unknown>));
                    }
                    return String(v);
                })
                .filter(Boolean);
            if (items.length > 0) {
                sections.push({ heading, body: `• ${items.join("\n• ")}` });
            }
        }
    }

    // Check for critiques array specifically
    if (Array.isArray(parsed["critiques"]) && !sections.find((s) => s.heading === "Critiques")) {
        const critiques = parsed["critiques"] as Record<string, unknown>[];
        const items = critiques.map((c) => {
            const target = c["target_role"] ?? c["target_agent"] ?? "Unknown";
            const challenge = c["challenge"] ?? c["critique"] ?? c["text"] ?? "";
            return `${capitalizeRole(String(target))}: ${cleanText(String(challenge))}`;
        }).filter(Boolean);
        if (items.length > 0) {
            sections.push({ heading: "Critiques", body: `• ${items.join("\n• ")}` });
        }
    }

    // Fallback if nothing was extracted
    if (sections.length === 0) {
        const first = extractFirstMeaningful(parsed);
        if (first) sections.push({ heading: "Response", body: cleanText(first) });
    }

    // Merge duplicate headings while preserving order.
    const merged = new Map<string, string>();
    const orderedHeadings: string[] = [];
    for (const section of sections) {
        const normalizedBody = cleanText(section.body);
        if (!normalizedBody) continue;
        if (!merged.has(section.heading)) {
            merged.set(section.heading, normalizedBody);
            orderedHeadings.push(section.heading);
            continue;
        }
        const existing = merged.get(section.heading) ?? "";
        if (existing.includes(normalizedBody)) continue;
        merged.set(section.heading, `${existing}\n\n${normalizedBody}`.trim());
    }

    return orderedHeadings.map((heading) => ({
        heading,
        body: merged.get(heading) ?? "",
    }));
}

function safeParse(raw: string): Record<string, unknown> | null {
    const str = stripCodeFences(String(raw)).trim();
    if (!str) return null;

    const direct = tryParseJsonObject(str);
    if (direct) return direct;

    const fenced = str.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
        const fromFence = tryParseJsonObject(fenced[1].trim());
        if (fromFence) return fromFence;
    }

    const extracted = extractFirstJsonObject(str);
    if (extracted) {
        const parsed = tryParseJsonObject(extracted);
        if (parsed) return parsed;
    }

    return null;
}

export function parseResponsePayload(raw: string | undefined | null): Record<string, unknown> | null {
    if (!raw) return null;
    return safeParse(raw);
}

export function extractFullResponse(raw: string | undefined | null): string {
    if (!raw) return "";
    const parsed = safeParse(raw);
    return extractPrimaryResponse(parsed, raw);
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(value);

        if (typeof parsed === "string") {
            return tryParseJsonObject(parsed);
        }

        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            const obj = parsed as Record<string, unknown>;
            if (typeof obj["text"] === "string") {
                const nested = tryParseJsonObject(String(obj["text"]));
                if (nested) return nested;
            }
            return obj;
        }
    } catch {
        // not JSON
    }
    return null;
}

function extractFirstJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    if (start < 0) return null;

    let depth = 0;
    for (let i = start; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === "{") depth += 1;
        if (ch === "}") {
            depth -= 1;
            if (depth === 0) {
                return text.slice(start, i + 1);
            }
        }
    }

    return null;
}

function extractShortSummary(parsed: Record<string, unknown> | null): string {
    if (!parsed) return "";
    const keys = ["short_summary", "summary", "brief", "tldr"];
    for (const key of keys) {
        if (typeof parsed[key] === "string" && String(parsed[key]).trim()) {
            return cleanText(String(parsed[key]));
        }
    }
    return "";
}

function extractPrimaryResponse(
    parsed: Record<string, unknown> | null,
    raw: string | null | undefined,
): string {
    if (parsed) {
        for (const key of [
            "response",
            "final_position",
            "final_stance",
            "main_argument",
            "stance",
            "challenge",
            "conclusion",
            "recommendation",
            "text",
        ]) {
            if (typeof parsed[key] === "string" && String(parsed[key]).trim()) {
                return cleanText(String(parsed[key]));
            }
        }
    }

    const cleaned = cleanText(String(raw ?? ""));
    return cleaned;
}

function deriveSummaryFromText(text: string, maxLen = 180): string {
    const cleaned = cleanText(text);
    if (!cleaned) return "";

    const sentence = firstMeaningfulSentence(cleaned) || cleaned;
    return truncate(sentence, maxLen);
}

// ── Truncation for node display ──────────────────────────────────────

export function truncateNodeText(text: string | undefined, maxLen = 80): string {
    if (!text) return "";
    const cleaned = cleanText(text);
    if (!cleaned) return "";
    const sentence = firstMeaningfulSentence(cleaned);
    return truncate(sentence || cleaned, maxLen);
}

// ── Helpers ──────────────────────────────────────────────────────────

function cleanText(str: string): string {
    let s = stripCodeFences(str).trim();
    // Remove wrapping braces/brackets that look like raw JSON
    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
        const parsed = safeParse(s);
        if (parsed) {
            const best = extractFirstMeaningful(parsed);
            if (best) return best;
        }
    }
    // Normalize common markdown artifacts for cleaner UI text.
    s = s
        .replace(/^\s{0,3}#{1,6}\s+/gm, "")
        .replace(/^\s*\*\*(.+?)\*\*\s*:?\s*$/gm, "$1")
        .replace(/^\s*[-*+]\s+/gm, "• ")
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    // Remove leading/trailing quotes
    if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
    return s;
}

function firstMeaningfulSentence(text: string): string {
    const normalized = text
        .replace(/\s+/g, " ")
        .replace(/^\s*[•\-]+\s*/, "")
        .trim();
    if (!normalized) return "";

    const sentences = normalized
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

    for (const sentence of sentences) {
        if (looksLikeLabel(sentence)) continue;
        return sentence;
    }

    return normalized;
}

function looksLikeLabel(text: string): boolean {
    return /^[A-Za-z][A-Za-z\s]{0,30}:$/.test(text.trim());
}

function stripCodeFences(value: string): string {
    const trimmed = value.trim();
    if (!trimmed.startsWith("```")) return value;
    return trimmed
        .replace(/^```[a-zA-Z0-9_-]*\s*/m, "")
        .replace(/\s*```$/m, "")
        .trim();
}

function parseMarkdownSections(raw: string): ContentSection[] {
    const text = stripCodeFences(raw).trim();
    if (!text) return [];

    const lines = text.split(/\r?\n/);
    const sections: ContentSection[] = [];
    let currentHeading: string | null = null;
    let buffer: string[] = [];

    const flush = () => {
        const body = cleanText(buffer.join("\n"));
        if (!body) return;
        sections.push({ heading: currentHeading ?? "Response", body });
        buffer = [];
    };

    for (const line of lines) {
        const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
        if (headingMatch) {
            if (buffer.length > 0) flush();
            currentHeading = cleanText(headingMatch[1]);
            continue;
        }

        const boldHeadingInline = line.match(/^\s*\*\*(.+?)\*\*\s*:\s*(.+)$/);
        if (boldHeadingInline) {
            if (buffer.length > 0) flush();
            currentHeading = cleanText(boldHeadingInline[1]);
            buffer.push(boldHeadingInline[2]);
            continue;
        }

        buffer.push(line);
    }

    if (buffer.length > 0) flush();
    return sections.filter((section) => section.heading && section.body);
}

function splitParagraphs(text: string): string[] {
    return text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);
}

function extractFirstString(obj: Record<string, unknown>): string {
    for (const val of Object.values(obj)) {
        if (typeof val === "string" && val.trim()) return val.trim();
    }
    return "";
}

function extractFirstMeaningful(obj: Record<string, unknown>): string {
    const priority = [
        "short_summary",
        "final_position",
        "final_stance",
        "main_argument",
        "stance",
        "summary",
        "position",
        "text",
        "challenge",
        "response",
    ];
    for (const key of priority) {
        if (typeof obj[key] === "string" && (obj[key] as string).trim()) {
            return (obj[key] as string).trim();
        }
    }
    return extractFirstString(obj);
}

function capitalizeRole(role: string | null | undefined): string {
    if (!role) return "Agent";
    return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase();
}

function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    const clipped = s.slice(0, Math.max(0, max - 1));
    const boundary = clipped.lastIndexOf(" ");
    if (boundary > Math.floor(max * 0.55)) {
        return `${clipped.slice(0, boundary).trimEnd()}…`;
    }
    return `${clipped.trimEnd()}…`;
}

function extractStance(
    parsed: Record<string, unknown> | null,
    raw: string | null | undefined,
): string {
    if (parsed) {
        for (const key of ["short_summary", "final_position", "final_stance", "stance", "summary", "position", "text"]) {
            if (typeof parsed[key] === "string" && (parsed[key] as string).trim()) {
                return truncate((parsed[key] as string).trim(), 150);
            }
        }
    }
    if (raw) {
        const cleaned = cleanText(raw);
        return truncate(cleaned, 150);
    }
    return "";
}

function hasCritiques(parsed: Record<string, unknown> | null): boolean {
    if (!parsed) return false;
    return Array.isArray(parsed["critiques"]) || typeof parsed["critique"] === "string";
}

function extractCritiqueTarget(parsed: Record<string, unknown> | null): string | null {
    if (!parsed) return null;
    const critiques = parsed["critiques"];
    if (Array.isArray(critiques) && critiques.length > 0) {
        const first = critiques[0] as Record<string, unknown> | undefined;
        if (first && typeof first["target_role"] === "string") {
            return first["target_role"] as string;
        }
    }
    if (typeof parsed["target_role"] === "string") return parsed["target_role"] as string;
    if (typeof parsed["target_agent"] === "string") return parsed["target_agent"] as string;
    return null;
}

function extractCritiqueSummary(
    parsed: Record<string, unknown> | null,
    raw: string | null | undefined,
): string {
    if (parsed) {
        const critiques = parsed["critiques"];
        if (Array.isArray(critiques) && critiques.length > 0) {
            const first = critiques[0] as Record<string, unknown> | undefined;
            if (first && typeof first["challenge"] === "string") {
                return truncate(first["challenge"] as string, 120);
            }
        }
        if (typeof parsed["critique"] === "string") {
            return truncate(parsed["critique"] as string, 120);
        }
    }
    return extractStance(parsed, raw) || "Raised concerns about another agent's position";
}

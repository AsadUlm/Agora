/**
 * Persona metadata (frontend mirror of `server/.../prompts/personas.py`).
 *
 * Keep this purely client-side and additive — used by the Agents panel and
 * NodeDetailDrawer header to enrich raw agent role strings with a friendly
 * persona title and short style description. If a role has no mapping we
 * just show the role string verbatim.
 */

export interface PersonaMeta {
    title: string;
    style: string;
    /** Tailwind text color used for the persona chip. */
    accentText: string;
    /** Tailwind border + bg color combo. */
    accentChip: string;
}

const _BY_KEY: Record<string, PersonaMeta> = {
    analyst: {
        title: "Strategic Analyst",
        style: "Evidence-driven, structured, policy-oriented.",
        accentText: "text-sky-200",
        accentChip: "bg-sky-500/15 border-sky-500/35",
    },
    critic: {
        title: "Adversarial Critic",
        style: "Pressure-tests assumptions and exposes contradictions.",
        accentText: "text-rose-200",
        accentChip: "bg-rose-500/15 border-rose-500/35",
    },
    creative: {
        title: "Creative Futurist",
        style: "Scenario-driven, unconventional, future-oriented.",
        accentText: "text-amber-200",
        accentChip: "bg-amber-500/15 border-amber-500/35",
    },
    devil_advocate: {
        title: "Devil's Advocate",
        style: "Argues the unpopular side to surface blind spots.",
        accentText: "text-orange-200",
        accentChip: "bg-orange-500/15 border-orange-500/35",
    },
    neutral: {
        title: "Neutral Synthesizer",
        style: "Integrates positions without taking a side.",
        accentText: "text-violet-200",
        accentChip: "bg-violet-500/15 border-violet-500/35",
    },
};

const _ALIASES: Record<string, keyof typeof _BY_KEY> = {
    analyst: "analyst",
    analytical: "analyst",
    strategist: "analyst",
    economist: "analyst",
    engineer: "analyst",
    scientist: "analyst",
    critic: "critic",
    skeptic: "critic",
    adversarial: "critic",
    ethicist: "critic",
    lawyer: "critic",
    creative: "creative",
    futurist: "creative",
    philosopher: "creative",
    visionary: "creative",
    artist: "creative",
    devil_advocate: "devil_advocate",
    contrarian: "devil_advocate",
    neutral: "neutral",
    balanced: "neutral",
    moderator: "neutral",
    synthesizer: "neutral",
};

export function getPersonaMeta(role: string | null | undefined): PersonaMeta | null {
    if (!role) return null;
    const key = _ALIASES[role.trim().toLowerCase()];
    return key ? _BY_KEY[key] : null;
}

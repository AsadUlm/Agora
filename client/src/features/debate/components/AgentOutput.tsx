import {
    Box,
    Card,
    CardContent,
    Chip,
    Divider,
    Stack,
    Typography,
} from "@mui/material";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import type {
    AgentRoundResult,
    CritiqueEntry,
    Round1Structured,
    Round2Structured,
    Round3Structured,
    RoundType,
} from "../../../types/debate";

// ── Status badge (shown only for non-success results) ─────────────────

function StatusBadge({
    status,
}: {
    status: AgentRoundResult["generation_status"];
}) {
    if (status === "success") return null;

    if (status === "skipped") {
        return (
            <Chip
                label="Skipped"
                size="small"
                icon={<SkipNextIcon fontSize="small" />}
                variant="outlined"
                color="default"
            />
        );
    }

    return (
        <Chip
            label="Generation failed"
            size="small"
            icon={<ErrorOutlineIcon fontSize="small" />}
            variant="outlined"
            color="error"
        />
    );
}

// ── Round-specific structured renderers ───────────────────────────────

function Round1Content({ data }: { data: Round1Structured }) {
    return (
        <Stack spacing={2}>
            <Box>
                <Typography
                    variant="caption"
                    sx={{ fontWeight: 700, textTransform: "uppercase", color: "text.secondary" }}
                >
                    Stance
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                    {data.stance}
                </Typography>
            </Box>

            {data.key_points?.length > 0 && (
                <Box>
                    <Typography
                        variant="caption"
                        sx={{ fontWeight: 700, textTransform: "uppercase", color: "text.secondary" }}
                    >
                        Key Points
                    </Typography>
                    <Stack component="ul" spacing={0.5} sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                        {data.key_points.map((pt, i) => (
                            <Typography component="li" key={i} variant="body2">
                                {pt}
                            </Typography>
                        ))}
                    </Stack>
                </Box>
            )}

            {data.confidence !== undefined && (
                <Box>
                    <Chip
                        label={`${Math.round(data.confidence * 100)}% confident`}
                        size="small"
                        variant="outlined"
                        color="primary"
                    />
                </Box>
            )}
        </Stack>
    );
}

function Round2Content({ data }: { data: Round2Structured }) {
    if (!data.critiques?.length) {
        return (
            <Typography variant="body2" color="text.secondary">
                No critiques recorded.
            </Typography>
        );
    }

    return (
        <Stack spacing={1.5}>
            {data.critiques.map((c: CritiqueEntry, i: number) => (
                <Box
                    key={i}
                    sx={{
                        p: 2,
                        borderRadius: 2,
                        bgcolor: "action.hover",
                        border: "1px solid",
                        borderColor: "divider",
                    }}
                >
                    <Typography
                        variant="body2"
                        sx={{ fontWeight: 700, color: "error.main", mb: 1 }}
                    >
                        → {c.target_role}
                    </Typography>
                    <Stack spacing={0.75}>
                        {c.challenge && (
                            <Typography variant="body2">
                                <Box component="span" sx={{ fontWeight: 600 }}>
                                    Challenge:{" "}
                                </Box>
                                {c.challenge}
                            </Typography>
                        )}
                        {c.weakness && (
                            <Typography variant="body2">
                                <Box component="span" sx={{ fontWeight: 600 }}>
                                    Weakness:{" "}
                                </Box>
                                {c.weakness}
                            </Typography>
                        )}
                        {c.counter_evidence && (
                            <Typography variant="body2">
                                <Box component="span" sx={{ fontWeight: 600 }}>
                                    Counter evidence:{" "}
                                </Box>
                                {c.counter_evidence}
                            </Typography>
                        )}
                    </Stack>
                </Box>
            ))}
        </Stack>
    );
}

function Round3Content({ data }: { data: Round3Structured }) {
    const fields: Array<{ key: keyof Round3Structured; label: string }> = [
        { key: "final_stance", label: "Final Stance" },
        { key: "what_changed", label: "What Changed" },
        { key: "remaining_concerns", label: "Remaining Concerns" },
        { key: "recommendation", label: "Recommendation" },
    ];

    return (
        <Stack spacing={1.5} divider={<Divider />}>
            {fields.map(({ key, label }) =>
                data[key] ? (
                    <Box key={key}>
                        <Typography
                            variant="caption"
                            sx={{
                                fontWeight: 700,
                                textTransform: "uppercase",
                                color: "text.secondary",
                            }}
                        >
                            {label}
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                            {data[key]}
                        </Typography>
                    </Box>
                ) : null,
            )}
        </Stack>
    );
}

function FallbackContent({ content }: { content: string }) {
    return (
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {content || "(No content)"}
        </Typography>
    );
}

// ── Content router — picks the right renderer ─────────────────────────

function StructuredContent({
    structured,
    content,
    roundType,
    status,
}: {
    structured: Record<string, unknown>;
    content: string;
    roundType: RoundType;
    status: AgentRoundResult["generation_status"];
}) {
    if (status === "failed") {
        return (
            <Typography variant="body2" color="text.secondary">
                {content || "Agent failed to generate a response."}
            </Typography>
        );
    }

    if (status === "skipped") {
        return (
            <Typography variant="body2" color="text.secondary">
                No opponents — cross-examination skipped for this agent.
            </Typography>
        );
    }

    // raw_content means JSON parse failed server-side; show plain text
    if (structured.raw_content) {
        return <FallbackContent content={String(structured.raw_content)} />;
    }

    if (roundType === "initial" && "stance" in structured) {
        return <Round1Content data={structured as unknown as Round1Structured} />;
    }

    if (roundType === "critique" && "critiques" in structured) {
        return <Round2Content data={structured as unknown as Round2Structured} />;
    }

    if (roundType === "final" && "final_stance" in structured) {
        return <Round3Content data={structured as unknown as Round3Structured} />;
    }

    // Final fallback: raw response text
    return <FallbackContent content={content} />;
}

// ── Main export ───────────────────────────────────────────────────────

interface AgentOutputProps {
    result: AgentRoundResult;
    roundType: RoundType;
}

export default function AgentOutput({ result, roundType }: AgentOutputProps) {
    return (
        <Card
            elevation={0}
            sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2 }}
        >
            <CardContent sx={{ p: 2.5, "&:last-child": { pb: 2.5 } }}>
                {/* Agent header */}
                <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                    sx={{ mb: 2 }}
                >
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                        {result.role}
                    </Typography>
                    <StatusBadge status={result.generation_status} />
                </Stack>

                <StructuredContent
                    structured={result.structured}
                    content={result.content}
                    roundType={roundType}
                    status={result.generation_status}
                />
            </CardContent>
        </Card>
    );
}

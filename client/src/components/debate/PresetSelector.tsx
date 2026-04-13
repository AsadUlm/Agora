import ThumbUpAltRoundedIcon from "@mui/icons-material/ThumbUpAltRounded";
import ThumbDownAltRoundedIcon from "@mui/icons-material/ThumbDownAltRounded";
import BarChartRoundedIcon from "@mui/icons-material/BarChartRounded";
import PsychologyRoundedIcon from "@mui/icons-material/PsychologyRounded";
import AccountTreeRoundedIcon from "@mui/icons-material/AccountTreeRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import { Box, Stack, Tooltip, Typography } from "@mui/material";

interface Preset {
    role: string;
    tagline: string;
    description: string;
    icon: React.ReactNode;
    color: string;
}

const PRESETS: Preset[] = [
    {
        role: "Proponent",
        tagline: "Argues in favor",
        description:
            "Builds the strongest case for the topic. Presents evidence, logical arguments, and anticipates counterarguments to defend the position.",
        icon: <ThumbUpAltRoundedIcon sx={{ fontSize: 18 }} />,
        color: "#6C8EF5",
    },
    {
        role: "Opponent",
        tagline: "Challenges the position",
        description:
            "Systematically argues against the topic. Identifies weaknesses, inconsistencies, and alternative interpretations to counter every claim.",
        icon: <ThumbDownAltRoundedIcon sx={{ fontSize: 18 }} />,
        color: "#F5A623",
    },
    {
        role: "Analyst",
        tagline: "Data-driven & objective",
        description:
            "Breaks down the topic with structured reasoning and evidence. Stays neutral and focuses on verifiable facts and measurable outcomes.",
        icon: <BarChartRoundedIcon sx={{ fontSize: 18 }} />,
        color: "#34D399",
    },
    {
        role: "Devil's Advocate",
        tagline: "Questions every assumption",
        description:
            "Challenges all positions — even seemingly obvious ones — to expose hidden flaws and stress-test every argument in the debate.",
        icon: <PsychologyRoundedIcon sx={{ fontSize: 18 }} />,
        color: "#F472B6",
    },
    {
        role: "Strategist",
        tagline: "Practical & long-term",
        description:
            "Evaluates practical implementation, feasibility, and long-term strategic impact. Focuses on what actually works in the real world.",
        icon: <AccountTreeRoundedIcon sx={{ fontSize: 18 }} />,
        color: "#A78BFA",
    },
    {
        role: "Risk Analyst",
        tagline: "Risks & downsides",
        description:
            "Focuses on potential failure modes, unintended consequences, and what could go wrong. Ensures no risk goes unexamined.",
        icon: <WarningAmberRoundedIcon sx={{ fontSize: 18 }} />,
        color: "#38BDF8",
    },
];

interface PresetSelectorProps {
    selected: string[];
    onChange: (roles: string[]) => void;
    disabled?: boolean;
}

export default function PresetSelector({ selected, onChange, disabled }: PresetSelectorProps) {
    function toggle(role: string) {
        if (disabled) return;
        if (selected.includes(role)) {
            if (selected.length <= 2) return; // enforce minimum 2 agents
            onChange(selected.filter((r) => r !== role));
        } else {
            onChange([...selected, role]);
        }
    }

    return (
        <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
                <Typography
                    variant="caption"
                    sx={{
                        color: "text.secondary",
                        fontSize: "0.72rem",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                    }}
                >
                    Select agent roles
                </Typography>
                <Typography variant="caption" sx={{ color: "text.secondary", fontSize: "0.7rem" }}>
                    {selected.length} selected · min 2
                </Typography>
            </Stack>

            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
                {PRESETS.map((preset) => {
                    const isSelected = selected.includes(preset.role);
                    const canDeselect = selected.length > 2;

                    return (
                        <Tooltip
                            key={preset.role}
                            title={
                                <Box sx={{ maxWidth: 220 }}>
                                    <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
                                        {preset.role}
                                    </Typography>
                                    <Typography variant="caption" sx={{ lineHeight: 1.5 }}>
                                        {preset.description}
                                    </Typography>
                                    {isSelected && !canDeselect && (
                                        <Typography
                                            variant="caption"
                                            sx={{ display: "block", mt: 0.75, color: "#F5A623", fontWeight: 600 }}
                                        >
                                            Minimum 2 agents required
                                        </Typography>
                                    )}
                                </Box>
                            }
                            placement="top"
                            arrow
                            enterDelay={300}
                        >
                            <Box
                                onClick={() => toggle(preset.role)}
                                sx={{
                                    p: 1.5,
                                    borderRadius: 2,
                                    border: `1px solid ${isSelected ? preset.color : "#2A2D3A"}`,
                                    bgcolor: isSelected ? `${preset.color}18` : "transparent",
                                    cursor: disabled
                                        ? "default"
                                        : isSelected && !canDeselect
                                        ? "not-allowed"
                                        : "pointer",
                                    transition: "border-color 0.15s, background-color 0.15s",
                                    opacity: disabled ? 0.45 : 1,
                                    "&:hover": !disabled
                                        ? {
                                              borderColor: preset.color,
                                              bgcolor: `${preset.color}0C`,
                                          }
                                        : {},
                                }}
                            >
                                <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.6 }}>
                                    <Box
                                        sx={{
                                            color: isSelected ? preset.color : "text.secondary",
                                            display: "flex",
                                            flexShrink: 0,
                                            transition: "color 0.15s",
                                        }}
                                    >
                                        {preset.icon}
                                    </Box>
                                    {isSelected && (
                                        <Box
                                            sx={{
                                                width: 5,
                                                height: 5,
                                                borderRadius: "50%",
                                                bgcolor: preset.color,
                                                flexShrink: 0,
                                            }}
                                        />
                                    )}
                                </Stack>
                                <Typography
                                    variant="body2"
                                    sx={{
                                        fontWeight: 700,
                                        fontSize: "0.78rem",
                                        color: isSelected ? "text.primary" : "text.secondary",
                                        lineHeight: 1.2,
                                        mb: 0.3,
                                        transition: "color 0.15s",
                                    }}
                                >
                                    {preset.role}
                                </Typography>
                                <Typography
                                    variant="caption"
                                    sx={{
                                        color: "text.secondary",
                                        fontSize: "0.67rem",
                                        lineHeight: 1.3,
                                        display: "-webkit-box",
                                        overflow: "hidden",
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: "vertical",
                                    }}
                                >
                                    {preset.tagline}
                                </Typography>
                            </Box>
                        </Tooltip>
                    );
                })}
            </Box>
        </Box>
    );
}

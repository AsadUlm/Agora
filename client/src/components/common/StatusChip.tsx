import type { ReactElement } from "react";
import { Chip, type ChipProps } from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import type { GenerationStatus } from "../../types/debate";

const config: Record<
    GenerationStatus,
    { label: string; color: ChipProps["color"]; icon: ReactElement }
> = {
    success: {
        label: "Success",
        color: "success",
        icon: <CheckCircleOutlineIcon fontSize="small" />,
    },
    failed: {
        label: "Failed",
        color: "error",
        icon: <ErrorOutlineIcon fontSize="small" />,
    },
    skipped: {
        label: "Skipped",
        color: "default",
        icon: <SkipNextIcon fontSize="small" />,
    },
};

interface StatusChipProps {
    status: GenerationStatus;
}

export default function StatusChip({ status }: StatusChipProps) {
    const { label, color, icon } = config[status] ?? config.failed;
    return <Chip label={label} color={color} icon={icon} size="small" variant="outlined" />;
}

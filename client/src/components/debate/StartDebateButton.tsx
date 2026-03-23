import { Button, CircularProgress } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";

interface StartDebateButtonProps {
    disabled: boolean;
    loading: boolean;
    onClick: () => void;
}

export default function StartDebateButton({
    disabled,
    loading,
    onClick,
}: StartDebateButtonProps) {
    return (
        <Button
            variant="contained"
            onClick={onClick}
            disabled={disabled}
            startIcon={
                loading ? (
                    <CircularProgress size={18} color="inherit" />
                ) : (
                    <PlayArrowIcon />
                )
            }
            sx={{
                minWidth: 150,
                height: 40,
                borderRadius: 2.5,
                fontWeight: 600,
                fontSize: "0.9rem",
                flexShrink: 0,
            }}
        >
            {loading ? "Running…" : "Start Debate"}
        </Button>
    );
}

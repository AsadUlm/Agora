import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import type { ConnectionStatus, DebatePhase } from "../../../types/ws";

interface Props {
    connectionStatus: ConnectionStatus;
    phase: DebatePhase;
}

/**
 * Shown when WebSocket is not yet connected or has disconnected.
 * Hidden once connected or debate is finished.
 */
export default function ConnectionStatusBar({ connectionStatus, phase }: Props) {
    // Don't show anything when fully connected or debate is already done
    if (connectionStatus === "connected") return null;
    if (phase === "completed" || phase === "failed") return null;

    if (connectionStatus === "connecting") {
        return (
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    px: 2,
                    py: 1.25,
                    borderRadius: 1.5,
                    bgcolor: "rgba(25, 118, 210, 0.07)",
                    border: "1px solid",
                    borderColor: "rgba(25, 118, 210, 0.3)",
                    mb: 3,
                }}
            >
                <CircularProgress size={16} thickness={4} color="info" />
                <Typography variant="body2" sx={{ color: "rgb(13, 71, 161)" }}>
                    Connecting to live debate stream…
                </Typography>
            </Box>
        );
    }

    if (connectionStatus === "disconnected") {
        return (
            <Alert severity="warning" icon={<WifiOffIcon />} sx={{ mb: 3 }}>
                Connection lost — attempting to reconnect…
            </Alert>
        );
    }

    if (connectionStatus === "error") {
        return (
            <Alert severity="error" icon={<WifiOffIcon />} sx={{ mb: 3 }}>
                Live connection failed. The debate may still be running — results will
                appear once complete.
            </Alert>
        );
    }

    return null;
}

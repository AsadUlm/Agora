import { createTheme } from "@mui/material/styles";

const theme = createTheme({
    palette: {
        mode: "light",
        primary: {
            main: "#1B2A4A",
            light: "#2E4068",
            dark: "#111D35",
        },
        secondary: {
            main: "#5C7CFA",
            light: "#849DFB",
            dark: "#3D5FD9",
        },
        background: {
            default: "#F5F6FA",
            paper: "#FFFFFF",
        },
        text: {
            primary: "#1A1D26",
            secondary: "#5F6577",
        },
        divider: "#E2E5EF",
        success: { main: "#2E7D4F" },
        error: { main: "#C93545" },
        warning: { main: "#D4860A" },
    },
    typography: {
        fontFamily: "'Inter', 'Roboto', 'Helvetica', 'Arial', sans-serif",
        h4: { fontWeight: 700, letterSpacing: "-0.02em" },
        h5: { fontWeight: 600, letterSpacing: "-0.01em" },
        h6: { fontWeight: 600 },
        subtitle1: { fontWeight: 500 },
        body2: { color: "#5F6577" },
    },
    shape: {
        borderRadius: 12,
    },
    components: {
        MuiCard: {
            defaultProps: { elevation: 0 },
            styleOverrides: {
                root: {
                    border: "1px solid #E2E5EF",
                },
            },
        },
        MuiButton: {
            styleOverrides: {
                root: {
                    textTransform: "none",
                    fontWeight: 600,
                    borderRadius: 10,
                    padding: "10px 24px",
                },
                sizeLarge: {
                    padding: "14px 32px",
                    fontSize: "1rem",
                },
            },
        },
        MuiTextField: {
            defaultProps: {
                variant: "outlined",
            },
        },
        MuiChip: {
            styleOverrides: {
                root: {
                    fontWeight: 500,
                },
            },
        },
    },
});

export default theme;

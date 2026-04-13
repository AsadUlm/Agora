import { createTheme } from "@mui/material/styles";

const theme = createTheme({
    palette: {
        mode: "dark",
        primary: {
            main: "#F5A623",
            light: "#F7BA55",
            dark: "#C4841A",
        },
        secondary: {
            main: "#6C8EF5",
            light: "#8FA8F8",
            dark: "#4A6BE0",
        },
        background: {
            default: "#0F1117",
            paper: "#1A1D27",
        },
        text: {
            primary: "#F0F0F0",
            secondary: "#9CA3AF",
        },
        divider: "#2A2D3A",
        success: { main: "#34D399" },
        error: { main: "#F87171" },
        warning: { main: "#FBBF24" },
    },
    typography: {
        fontFamily: "'Inter', 'Roboto', 'Helvetica', 'Arial', sans-serif",
        h4: { fontWeight: 700, letterSpacing: "-0.02em" },
        h5: { fontWeight: 600, letterSpacing: "-0.01em" },
        h6: { fontWeight: 600 },
        subtitle1: { fontWeight: 500 },
        body2: { color: "#9CA3AF" },
    },
    shape: {
        borderRadius: 12,
    },
    components: {
        MuiCard: {
            defaultProps: { elevation: 0 },
            styleOverrides: {
                root: {
                    border: "1px solid #2A2D3A",
                    backgroundImage: "none",
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
                containedPrimary: {
                    color: "#0F1117",
                    "&:hover": {
                        backgroundColor: "#F7BA55",
                    },
                },
            },
        },
        MuiTextField: {
            defaultProps: {
                variant: "outlined",
            },
        },
        MuiOutlinedInput: {
            styleOverrides: {
                root: {
                    "& .MuiOutlinedInput-notchedOutline": {
                        borderColor: "#2A2D3A",
                    },
                    "&:hover .MuiOutlinedInput-notchedOutline": {
                        borderColor: "#6C8EF5",
                    },
                },
            },
        },
        MuiCssBaseline: {
            styleOverrides: {
                "input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus, input:-webkit-autofill:active": {
                    WebkitBoxShadow: "0 0 0 1000px #1A1D27 inset !important",
                    WebkitTextFillColor: "#F0F0F0 !important",
                    caretColor: "#F0F0F0",
                    borderRadius: "inherit",
                },
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: "none",
                },
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

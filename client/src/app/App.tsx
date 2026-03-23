import { ThemeProvider, CssBaseline } from "@mui/material";
import theme from "../theme";
import DebatePage from "../pages/DebatePage";

export default function App() {
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <DebatePage />
        </ThemeProvider>
    );
}

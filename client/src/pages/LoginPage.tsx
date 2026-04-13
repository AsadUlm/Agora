import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import { Alert, Box, Button, IconButton, InputAdornment, Stack, TextField, Typography,
} from "@mui/material";
import { useState } from "react";
import { Link } from "react-router-dom";
import AuthLayout from "../components/auth/AuthLayout";
import { useAuth } from "../hooks/useAuth";

function validateEmail(v: string) {
    if (!v) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Enter a valid email address";
    return null;
}

function validatePassword(v: string) {
    if (!v) return "Password is required";
    return null;
}

export default function LoginPage() {
    const { login, loading, error, clearError } = useAuth();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);

    const [emailErr, setEmailErr] = useState<string | null>(null);
    const [passwordErr, setPasswordErr] = useState<string | null>(null);

    function validate(): boolean {
        const eErr = validateEmail(email);
        const pErr = validatePassword(password);
        setEmailErr(eErr);
        setPasswordErr(pErr);
        return !eErr && !pErr;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        clearError();
        if (!validate()) return;
        await login({ email: email.trim(), password }).catch(() => {
            // error is set in context
        });
    }

    return (
        <AuthLayout subtitle="Sign in to your account">
            <form onSubmit={handleSubmit} noValidate>
                <Stack spacing={2}>
                    {error && (
                        <Alert severity="error" onClose={clearError}>
                            {error}
                        </Alert>
                    )}

                    <TextField
                        label="Email"
                        type="email"
                        autoComplete="email"
                        autoFocus
                        fullWidth
                        required
                        value={email}
                        onChange={(e) => {
                            setEmail(e.target.value);
                            if (emailErr) setEmailErr(null);
                        }}
                        error={!!emailErr}
                        helperText={emailErr}
                    />

                    <TextField
                        label="Password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        fullWidth
                        required
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            if (passwordErr) setPasswordErr(null);
                        }}
                        error={!!passwordErr}
                        helperText={passwordErr}
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton
                                        aria-label="toggle password visibility"
                                        onClick={() => setShowPassword((v) => !v)}
                                        edge="end"
                                        size="small"
                                    >
                                        {showPassword ? <VisibilityOff /> : <Visibility />}
                                    </IconButton>
                                </InputAdornment>
                            ),
                        }}
                    />

                    <Button
                        type="submit"
                        variant="contained"
                        fullWidth
                        size="large"
                        disabled={loading}
                    >
                        {loading ? "Signing in…" : "Sign in"}
                    </Button>
                </Stack>
            </form>


            <Box sx={{ mt: 3, textAlign: "center" }}>
                <Typography variant="body2" color="text.secondary">
                    Don't have an account?{" "}
                    <Typography
                        component={Link}
                        to="/signup"
                        variant="body2"
                        sx={{ color: "secondary.main", fontWeight: 600, textDecoration: "none" }}
                    >
                        Sign up
                    </Typography>
                </Typography>
            </Box>
        </AuthLayout>
    );
}

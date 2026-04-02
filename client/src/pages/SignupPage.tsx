import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import {
    Alert, Box, Button, IconButton, InputAdornment, Stack, TextField,
    Typography,
} from "@mui/material";
import { useState } from "react";
import { Link } from "react-router-dom";
import AuthLayout from "../components/auth/AuthLayout";
import { useAuth } from "../hooks/useAuth";

// ── Validation ────────────────────────────────────────────────────────

function validateEmail(v: string) {
    if (!v) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Enter a valid email address";
    return null;
}

function validatePassword(v: string) {
    if (!v) return "Password is required";
    if (v.length < 8) return "Password must be at least 8 characters";
    if (!/[a-zA-Z]/.test(v)) return "Password must contain at least one letter";
    if (!/\d/.test(v)) return "Password must contain at least one digit";
    return null;
}

function validateConfirm(password: string, confirm: string) {
    if (!confirm) return "Please confirm your password";
    if (password !== confirm) return "Passwords do not match";
    return null;
}

export default function SignupPage() {
    const { signup, loading, error, clearError } = useAuth();

    const [email, setEmail] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    const [emailErr, setEmailErr] = useState<string | null>(null);
    const [passwordErr, setPasswordErr] = useState<string | null>(null);
    const [confirmErr, setConfirmErr] = useState<string | null>(null);

    function validate(): boolean {
        const eErr = validateEmail(email);
        const pErr = validatePassword(password);
        const cErr = validateConfirm(password, confirm);
        setEmailErr(eErr);
        setPasswordErr(pErr);
        setConfirmErr(cErr);
        return !eErr && !pErr && !cErr;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        clearError();
        if (!validate()) return;
        await signup({
            email: email.trim(),
            password,
            display_name: displayName.trim() || undefined,
        }).catch(() => {
            // error is set in context
        });
    }

    return (
        <AuthLayout title="Create account" subtitle="Start debating with AI agents">
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
                        label="Display name (optional)"
                        autoComplete="name"
                        fullWidth
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                    />

                    <TextField
                        label="Password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="new-password"
                        fullWidth
                        required
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            if (passwordErr) setPasswordErr(null);
                            if (confirmErr && confirm) setConfirmErr(validateConfirm(e.target.value, confirm));
                        }}
                        error={!!passwordErr}
                        helperText={passwordErr ?? "Min 8 chars, at least one letter and one digit"}
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

                    <TextField
                        label="Confirm password"
                        type={showConfirm ? "text" : "password"}
                        autoComplete="new-password"
                        fullWidth
                        required
                        value={confirm}
                        onChange={(e) => {
                            setConfirm(e.target.value);
                            if (confirmErr) setConfirmErr(null);
                        }}
                        error={!!confirmErr}
                        helperText={confirmErr}
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton
                                        aria-label="toggle confirm password visibility"
                                        onClick={() => setShowConfirm((v) => !v)}
                                        edge="end"
                                        size="small"
                                    >
                                        {showConfirm ? <VisibilityOff /> : <Visibility />}
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
                        {loading ? "Creating account…" : "Create account"}
                    </Button>
                </Stack>
            </form>

            <Box sx={{ mt: 3, textAlign: "center" }}>
                <Typography variant="body2" color="text.secondary">
                    Already have an account?{" "}
                    <Typography
                        component={Link}
                        to="/login"
                        variant="body2"
                        sx={{ color: "secondary.main", fontWeight: 600, textDecoration: "none" }}
                    >
                        Sign in
                    </Typography>
                </Typography>
            </Box>
        </AuthLayout>
    );
}

import { useState } from "react";
import AgoraLogoIcon from "@/features/debate/ui/AgoraLogoIcon";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "motion/react";
import { useAuthStore } from "@/features/auth/model/auth.store";
import { cn } from "@/shared/lib/cn";

export default function SignupPage() {
    const navigate = useNavigate();
    const signup = useAuthStore((s) => s.signup);
    const error = useAuthStore((s) => s.error);
    const clearError = useAuthStore((s) => s.clearError);

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await signup({
                email,
                password,
                display_name: displayName || undefined,
            });
            navigate("/debates");
        } catch {
            /* error set in store */
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-agora-bg flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-sm"
            >
                <div className="text-center mb-8">
                    <div className="mx-auto mb-4 w-fit shadow-lg shadow-indigo-500/20 rounded-[11px] overflow-hidden">
                        <AgoraLogoIcon size={56} />
                    </div>
                    <h1 className="text-xl font-semibold text-white">Join AGORA</h1>
                    <p className="text-sm text-agora-text-muted mt-1">
                        Create your account
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: -5 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400"
                        >
                            {error}
                            <button
                                type="button"
                                onClick={clearError}
                                className="float-right text-red-400/60 hover:text-red-400"
                            >
                                ✕
                            </button>
                        </motion.div>
                    )}

                    <div>
                        <label
                            htmlFor="displayName"
                            className="block text-xs font-medium text-agora-text-muted mb-1.5"
                        >
                            Display Name (optional)
                        </label>
                        <input
                            id="displayName"
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-lg bg-agora-surface-light border border-agora-border text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-indigo-500/50"
                            placeholder="Jane Doe"
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="email"
                            className="block text-xs font-medium text-agora-text-muted mb-1.5"
                        >
                            Email
                        </label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="w-full px-3 py-2.5 rounded-lg bg-agora-surface-light border border-agora-border text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-indigo-500/50"
                            placeholder="you@example.com"
                        />
                    </div>

                    <div>
                        <label
                            htmlFor="password"
                            className="block text-xs font-medium text-agora-text-muted mb-1.5"
                        >
                            Password
                        </label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            minLength={8}
                            className="w-full px-3 py-2.5 rounded-lg bg-agora-surface-light border border-agora-border text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-indigo-500/50"
                            placeholder="Minimum 8 characters"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={submitting}
                        className={cn(
                            "w-full py-2.5 rounded-lg text-sm font-medium transition-all",
                            submitting
                                ? "bg-indigo-700 text-indigo-300 cursor-wait"
                                : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-md shadow-indigo-500/20",
                        )}
                    >
                        {submitting ? "Creating account..." : "Create account"}
                    </button>
                </form>

                <p className="text-center text-xs text-agora-text-muted mt-6">
                    Already have an account?{" "}
                    <Link
                        to="/login"
                        className="text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                        Sign in
                    </Link>
                </p>
            </motion.div>
        </div>
    );
}

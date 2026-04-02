import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

/**
 * Wraps a route that requires authentication.
 * Unauthenticated users are redirected to /login with a `from` state
 * so they can be sent back after a successful login.
 */
export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        // Avoid flash-redirect while session is being restored on mount
        return null;
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    return <>{children}</>;
}

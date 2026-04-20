import { Outlet } from "react-router-dom";
import AppSidebar from "./AppSidebar";

export default function AppShell() {
    return (
        <div className="min-h-screen flex bg-agora-bg">
            <AppSidebar />
            <main className="flex-1 min-w-0 overflow-auto">
                <Outlet />
            </main>
        </div>
    );
}

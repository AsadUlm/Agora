import { Outlet } from "react-router-dom";
import AppSidebar from "./AppSidebar";

export default function AppShell() {
    return (
        <div className="h-screen overflow-hidden flex bg-agora-bg">
            <AppSidebar />
            <main className="flex-1 min-w-0 overflow-y-auto">
                <Outlet />
            </main>
        </div>
    );
}

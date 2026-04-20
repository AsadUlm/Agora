export function formatRelativeTime(date: string | Date): string {
    const d = typeof date === "string" ? new Date(date) : date;
    const now = Date.now();
    const diff = now - d.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString();
}

export function formatTime(date: string | Date): string {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
    });
}

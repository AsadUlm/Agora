/**
 * Minimal toast notification system — Zustand-backed, no external deps.
 *
 *   import { toast } from "@/shared/ui/toast";
 *   toast.success("Saved");
 *   toast.error("Something broke");
 *
 * Mount <Toaster /> once near the app root.
 */

import { useEffect } from "react";
import { create } from "zustand";

export type ToastKind = "success" | "error" | "info";

export interface ToastItem {
    id: number;
    kind: ToastKind;
    message: string;
}

interface ToastState {
    items: ToastItem[];
    push: (kind: ToastKind, message: string) => void;
    remove: (id: number) => void;
}

let _id = 1;

const useToastStore = create<ToastState>((set) => ({
    items: [],
    push: (kind, message) => {
        const id = _id++;
        set((s) => ({ items: [...s.items, { id, kind, message }] }));
        setTimeout(() => {
            set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
        }, 3800);
    },
    remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

export const toast = {
    success: (message: string) => useToastStore.getState().push("success", message),
    error: (message: string) => useToastStore.getState().push("error", message),
    info: (message: string) => useToastStore.getState().push("info", message),
};

export function Toaster() {
    const items = useToastStore((s) => s.items);
    const remove = useToastStore((s) => s.remove);

    // Auto-cleanup safety: in StrictMode the setTimeout in push still fires,
    // but defensively clear on unmount.
    useEffect(() => () => useToastStore.setState({ items: [] }), []);

    if (items.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
            {items.map((t) => {
                const tone =
                    t.kind === "success"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : t.kind === "error"
                            ? "border-red-500/40 bg-red-500/10 text-red-200"
                            : "border-indigo-500/40 bg-indigo-500/10 text-indigo-200";
                return (
                    <div
                        key={t.id}
                        onClick={() => remove(t.id)}
                        className={`pointer-events-auto cursor-pointer min-w-[220px] max-w-[360px] rounded-lg border px-3.5 py-2.5 text-xs font-medium shadow-lg backdrop-blur-sm ${tone}`}
                    >
                        {t.message}
                    </div>
                );
            })}
        </div>
    );
}

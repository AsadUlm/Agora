import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query and re-render when it changes.
 *
 * @example
 *   const isMobile = useMediaQuery("(max-width: 767px)");
 */
export function useMediaQuery(query: string): boolean {
    const getMatch = () =>
        typeof window !== "undefined" && typeof window.matchMedia === "function"
            ? window.matchMedia(query).matches
            : false;

    const [matches, setMatches] = useState<boolean>(getMatch);

    useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
            return;
        }

        const mql = window.matchMedia(query);
        const handler = (event: MediaQueryListEvent) => setMatches(event.matches);

        // Sync immediately in case the query changed between render and effect.
        setMatches(mql.matches);
        mql.addEventListener("change", handler);

        return () => mql.removeEventListener("change", handler);
    }, [query]);

    return matches;
}

/** Tailwind-aligned breakpoint helpers (md = 768px). */
export const useIsMobile = () => useMediaQuery("(max-width: 767px)");
export const useIsTablet = () => useMediaQuery("(min-width: 768px) and (max-width: 1023px)");
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");

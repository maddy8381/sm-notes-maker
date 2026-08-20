"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * Theme state.
 *
 * Replaces next-themes, which on Next 16 / React 19 renders its anti-flash
 * script from a Client Component — something React refuses to execute and
 * warns about on every navigation. The three things actually needed here are
 * small enough to own outright: a class on <html>, persistence, and following
 * the system preference until the user overrides it.
 *
 * localStorage is treated as the source of truth and read through
 * `useSyncExternalStore`. That is what this hook is for: it gives a correct
 * server snapshot, avoids the read-in-an-effect-then-setState pattern that
 * paints the wrong theme for a frame, and makes cross-tab sync fall out for
 * free rather than needing its own listener.
 *
 * The first paint is handled by ThemeScript in the root layout. This provider
 * only takes over once React is running.
 */

export const THEME_STORAGE_KEY = "tn.theme";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  /** What is actually on screen — "system" resolved against the OS setting. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return context;
}

// --- the external store ----------------------------------------------------

/** Fired on setTheme so this tab updates; `storage` covers the others. */
const THEME_EVENT = "tn:themechange";

function subscribeToTheme(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(THEME_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(THEME_EVENT, onChange);
  };
}

function getStoredTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    // Private mode or storage disabled — follow the system.
    return "system";
  }
}

/** Server snapshot. Must be stable, hence a module-level constant. */
function getServerTheme(): Theme {
  return "system";
}

function apply(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  // Makes form controls, scrollbars and the like follow the theme too.
  root.style.colorScheme = resolved;
}

// --- provider --------------------------------------------------------------

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeToTheme, getStoredTheme, getServerTheme);

  // Only meaningful while `theme` is "system"; otherwise `theme` decides.
  const [systemPreference, setSystemPreference] = useState<ResolvedTheme>("light");

  const resolvedTheme: ResolvedTheme = theme === "system" ? systemPreference : theme;

  // Subscribes to an external system and updates state from its callback,
  // which is what effects are for. The initial read happens in the same
  // listener, invoked immediately below.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const onChange = () => setSystemPreference(media.matches ? "dark" : "light");
    onChange();

    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // Keeps the DOM in step with React state — the other thing effects are for.
  useEffect(() => {
    apply(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    // Disable transitions for one frame. Without this, every surface on the
    // page cross-fades at once, which reads as a rendering bug rather than a
    // flourish.
    const style = document.createElement("style");
    style.appendChild(
      document.createTextNode("*,*::before,*::after{transition:none!important}"),
    );
    document.head.appendChild(style);

    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Preference will not persist, but the current page still switches.
    }

    // `storage` does not fire in the tab that wrote it, so nudge the store
    // directly. Other tabs get the native event.
    window.dispatchEvent(new Event(THEME_EVENT));

    // Forces a reflow so the style above takes effect before it is removed.
    window.getComputedStyle(document.body);
    requestAnimationFrame(() => style.remove());
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

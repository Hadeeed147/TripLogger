import { useCallback, useState } from "react";
import "./ThemeToggle.css";
import { applyTheme, getInitialTheme, persistTheme, type Theme } from "../theme";

/**
 * Sun/moon icon toggle for the app header. Two-state (light/dark): initial
 * value comes from getInitialTheme() (saved localStorage choice, else OS
 * preference — see src/theme.ts), and the same value has already been
 * applied to <html data-theme> before first paint by the inline snippet in
 * index.html, so this component's first render always matches what's on
 * screen (no flash, no mismatch).
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const isDark = theme === "dark";

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      persistTheme(next);
      return next;
    });
  }, []);

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={isDark}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.75v2.5M12 18.75v2.5M4.929 4.929l1.768 1.768M17.303 17.303l1.768 1.768M2.75 12h2.5M18.75 12h2.5M4.929 19.071l1.768-1.768M17.303 6.697l1.768-1.768" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.354 15.354A9 9 0 0 1 8.646 3.646a.75.75 0 0 0-.933-1.025A10.5 10.5 0 1 0 22.38 16.288a.75.75 0 0 0-1.026-.934 9.02 9.02 0 0 1-1 0Z" />
    </svg>
  );
}

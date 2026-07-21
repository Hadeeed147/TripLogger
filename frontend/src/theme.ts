// Theme persistence + resolution helpers shared by the pre-paint snippet in
// index.html and the header toggle (src/components/ThemeToggle.tsx). Kept
// tiny and framework-free so index.html's inline script can mirror the same
// key/logic without importing this module (inline scripts can't use ESM
// imports before the app bundle loads).
export const THEME_STORAGE_KEY = "triplogger-theme";

export type Theme = "light" | "dark";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The explicit choice the user previously made, if any (null = "follow system"). */
export function getStoredTheme(): Theme | null {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : null;
}

/** Stored preference if one exists, otherwise the OS/browser preference. */
export function getInitialTheme(): Theme {
  return getStoredTheme() ?? (systemPrefersDark() ? "dark" : "light");
}

/** Sets the `data-theme` attribute that tokens.css keys its dark overrides off of. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function persistTheme(theme: Theme): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

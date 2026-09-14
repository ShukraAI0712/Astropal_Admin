'use client';

import {
  createContext, useCallback, useContext, useMemo, useSyncExternalStore,
} from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'light', toggle: () => {} });

const STORAGE_KEY = 'astropal_admin_theme';

/**
 * The theme lives on the `<html>` element, not in React.
 *
 * The inline script in `<head>` applies the class before first paint so a
 * dark-mode user never sees a white flash, which means the DOM already holds
 * the answer by the time React runs. Reading it with `useSyncExternalStore`
 * rather than syncing it into state inside an effect is what keeps the two
 * from disagreeing: the server renders the light default, hydration reads the
 * real class, and there is no cascading re-render in between.
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function readTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** The server has no DOM, and light is this tool's default. */
function serverTheme(): Theme {
  return 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);

  // Reads the class rather than the rendered value: the DOM is the source of
  // truth here, so the toggle cannot act on a stale copy of it.
  const toggle = useCallback(() => {
    const next: Theme = readTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing or blocked storage - the toggle still works for this
      // page view, it just will not be remembered.
    }
  }, []);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * Runs before first paint to set the theme class, so a dark-mode user never
 * sees a white flash. Kept as a string so it can go in a <script> tag in
 * <head> ahead of any rendering.
 */
export const themeInitScript = `
(function() {
  try {
    // Light is the default for this tool; dark is opt-in and remembered.
    if (localStorage.getItem('${STORAGE_KEY}') === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
`;

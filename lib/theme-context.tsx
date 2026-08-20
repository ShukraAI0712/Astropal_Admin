'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: 'light', toggle: () => {} });

const STORAGE_KEY = 'astropal_admin_theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Start with the value the inline script in <head> already applied, so the
  // React tree agrees with the DOM and there is no flash or hydration mismatch.
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    setTheme(current);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Private browsing or blocked storage - the toggle still works for
        // this page view, it just will not be remembered.
      }
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
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

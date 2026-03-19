/**
 * Mudbrick v2 -- Dark Mode Hook
 *
 * Manages theme toggle with CSS custom properties.
 * Persists preference in localStorage via the UI store.
 */

import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';

/**
 * Hook that syncs the theme from the UI store to the HTML attribute.
 * Call once in App.tsx to apply the theme globally.
 */
export function useDarkMode() {
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Initialize from system preference on first load
  useEffect(() => {
    const stored = localStorage.getItem('mudbrick-theme');
    if (stored === 'dark' || stored === 'light') {
      useUIStore.getState().setTheme(stored);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      useUIStore.getState().setTheme('dark');
    }
  }, []);

  // Persist to localStorage when theme changes
  useEffect(() => {
    localStorage.setItem('mudbrick-theme', theme);
  }, [theme]);

  return { theme, toggleTheme, isDark: theme === 'dark' };
}

import type { Density } from '@hrm/design-tokens';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemePreference = 'light' | 'dark' | 'system';

interface PreferencesState {
  theme: ThemePreference;
  density: Density;
  sidebarCollapsed: boolean;
  setTheme: (theme: ThemePreference) => void;
  setDensity: (density: Density) => void;
  toggleSidebar: () => void;
}

/**
 * Per-device UI preferences. Persisted in localStorage under `hrm.preferences`
 * (the pre-paint script in index.html reads the same key to avoid theme flashes).
 */
export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: 'system',
      density: 'compact',
      sidebarCollapsed: false,
      setTheme: (theme) => {
        set({ theme });
      },
      setDensity: (density) => {
        set({ density });
      },
      toggleSidebar: () => {
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
      },
    }),
    {
      name: 'hrm.preferences',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        theme: s.theme,
        density: s.density,
        sidebarCollapsed: s.sidebarCollapsed,
      }),
    },
  ),
);

export function resolveTheme(pref: ThemePreference, systemDark: boolean): 'light' | 'dark' {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

import { useEffect } from 'react';
import { resolveTheme, usePreferences } from '@/stores/preferences';

/** Keeps <html> theme class and density attribute in sync with preferences and the OS theme. */
export function useApplyPreferences(): void {
  const theme = usePreferences((s) => s.theme);
  const density = usePreferences((s) => s.density);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.classList.toggle(
        'dark',
        resolveTheme(theme, media.matches) === 'dark',
      );
    };
    apply();
    media.addEventListener('change', apply);
    return () => {
      media.removeEventListener('change', apply);
    };
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);
}

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useApplyPreferences } from '@/app/use-apply-preferences';
import { resolveTheme, usePreferences } from './preferences';

describe('preferences', () => {
  it('resolves the system theme from the OS setting', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('applies theme and density to <html> and persists them', () => {
    renderHook(() => {
      useApplyPreferences();
    });
    act(() => {
      usePreferences.getState().setTheme('dark');
      usePreferences.getState().setDensity('comfortable');
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.dataset.density).toBe('comfortable');
    expect(JSON.parse(localStorage.getItem('hrm.preferences') ?? '{}')).toMatchObject({
      state: { theme: 'dark', density: 'comfortable' },
    });
  });
});

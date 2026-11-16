import { describe, expect, it } from 'vitest';
import { colors, type ColorTokens, type ThemeName } from './colors.js';
import { contrastRatio } from './contrast.js';
import { buildCssVariables } from './css.js';

/** [surface, text, minimum ratio]. 4.5 = WCAG AA body text, 3 = UI components / large text. */
const pairs: [keyof ColorTokens, keyof ColorTokens, number][] = [
  ['background', 'foreground', 4.5],
  ['background', 'mutedForeground', 4.5],
  ['card', 'cardForeground', 4.5],
  ['card', 'mutedForeground', 4.5],
  ['muted', 'mutedForeground', 4.5],
  ['popover', 'popoverForeground', 4.5],
  ['primary', 'primaryForeground', 4.5],
  ['secondary', 'secondaryForeground', 4.5],
  ['accent', 'accentForeground', 4.5],
  ['destructive', 'destructiveForeground', 4.5],
  ['success', 'successForeground', 4.5],
  ['warning', 'warningForeground', 4.5],
  ['info', 'infoForeground', 4.5],
  ['sidebar', 'sidebarForeground', 4.5],
  ['sidebar', 'sidebarMuted', 4.5],
  ['sidebarAccent', 'sidebarAccentForeground', 4.5],
  ['background', 'ring', 3],
];

describe.each(['light', 'dark'] satisfies ThemeName[])('%s theme contrast (WCAG AA)', (theme) => {
  const t = colors[theme];
  it.each(pairs)('%s / %s >= %d', (surface, text, min) => {
    expect(contrastRatio(t[surface], t[text])).toBeGreaterThanOrEqual(min);
  });
});

describe('theme parity', () => {
  it('light and dark define identical token keys', () => {
    expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(colors.light).sort());
  });
});

describe('buildCssVariables', () => {
  const css = buildCssVariables();
  it('emits kebab-case variables for both themes', () => {
    expect(css).toContain('--primary-foreground: #ffffff;');
    expect(css).toContain('.dark {');
    expect(css).toContain('--sidebar-accent-foreground:');
    expect(css).toContain('--chart-1:');
  });
  it('sets the native color-scheme per theme', () => {
    expect(css).toContain('color-scheme: light;');
    expect(css).toContain('color-scheme: dark;');
    expect(css).not.toContain('--color-scheme');
  });
  it('emits density overrides', () => {
    expect(css).toContain('[data-density="comfortable"]');
  });
});

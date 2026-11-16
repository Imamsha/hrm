/** Spacing scale in px (4px grid). */
export const spacing = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  full: 9999,
} as const;

export const fontFamily = {
  sans: '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
} as const;

/** Type scale: [fontSize px, lineHeight px]. Compact enterprise scale with a 13px body. */
export const fontSize = {
  xs: [11, 16],
  sm: [12, 16],
  base: [13, 20],
  md: [14, 20],
  lg: [16, 24],
  xl: [18, 28],
  '2xl': [22, 30],
  '3xl': [28, 36],
} as const satisfies Record<string, readonly [number, number]>;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export type Density = 'compact' | 'comfortable';

/** Control and row sizes per density mode, in px. */
export const density: Record<Density, { control: number; row: number; gap: number }> = {
  compact: { control: 30, row: 34, gap: 8 },
  comfortable: { control: 36, row: 44, gap: 12 },
};

export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export const motion = {
  fast: 120,
  base: 180,
  slow: 280,
} as const;

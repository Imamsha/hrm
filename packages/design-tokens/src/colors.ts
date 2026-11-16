/**
 * Semantic color tokens. Hex values are used so the same tokens work on the web
 * (CSS custom properties) and in React Native (which has no oklch support).
 *
 * Every `*Foreground` token is the text color intended for its paired surface;
 * pairs are verified against WCAG AA in `colors.test.ts`.
 */
export interface ColorTokens {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  muted: string;
  mutedForeground: string;
  subtle: string;
  border: string;
  input: string;
  ring: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  success: string;
  successForeground: string;
  warning: string;
  warningForeground: string;
  info: string;
  infoForeground: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarMuted: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
}

export type ThemeName = 'light' | 'dark';

export const colors: Record<ThemeName, ColorTokens> = {
  light: {
    background: '#ffffff',
    foreground: '#0e1116',
    card: '#ffffff',
    cardForeground: '#0e1116',
    popover: '#ffffff',
    popoverForeground: '#0e1116',
    muted: '#f4f5f7',
    mutedForeground: '#596070',
    subtle: '#fafafb',
    border: '#e3e5ea',
    input: '#d5d9e0',
    ring: '#4f46e5',
    primary: '#4f46e5',
    primaryForeground: '#ffffff',
    secondary: '#f1f2f5',
    secondaryForeground: '#191c23',
    accent: '#eef0f4',
    accentForeground: '#191c23',
    destructive: '#c81e1e',
    destructiveForeground: '#ffffff',
    success: '#15803d',
    successForeground: '#ffffff',
    warning: '#a14a06',
    warningForeground: '#ffffff',
    info: '#0369a1',
    infoForeground: '#ffffff',
    sidebar: '#f7f8fa',
    sidebarForeground: '#23272f',
    sidebarMuted: '#5f6676',
    sidebarAccent: '#eceef2',
    sidebarAccentForeground: '#0e1116',
    sidebarBorder: '#e3e5ea',
    chart1: '#4f46e5',
    chart2: '#0891b2',
    chart3: '#16a34a',
    chart4: '#d97706',
    chart5: '#db2777',
  },
  dark: {
    background: '#0b0d11',
    foreground: '#e6e8ec',
    card: '#111419',
    cardForeground: '#e6e8ec',
    popover: '#14171d',
    popoverForeground: '#e6e8ec',
    muted: '#181b22',
    mutedForeground: '#959cab',
    subtle: '#0e1015',
    border: '#242833',
    input: '#2d3240',
    ring: '#8b87ff',
    primary: '#5450e6',
    primaryForeground: '#ffffff',
    secondary: '#1b1f28',
    secondaryForeground: '#e6e8ec',
    accent: '#1d212b',
    accentForeground: '#f1f2f5',
    destructive: '#d9302f',
    destructiveForeground: '#ffffff',
    success: '#22c55e',
    successForeground: '#04210f',
    warning: '#f59e0b',
    warningForeground: '#241500',
    info: '#38bdf8',
    infoForeground: '#03202e',
    sidebar: '#0e1015',
    sidebarForeground: '#d4d7de',
    sidebarMuted: '#8c93a2',
    sidebarAccent: '#1a1e27',
    sidebarAccentForeground: '#f1f2f5',
    sidebarBorder: '#1f232c',
    chart1: '#8b87ff',
    chart2: '#22d3ee',
    chart3: '#4ade80',
    chart4: '#fbbf24',
    chart5: '#f472b6',
  },
};

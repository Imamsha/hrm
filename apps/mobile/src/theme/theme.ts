import {
  type ColorTokens,
  colors,
  fontSize,
  fontWeight,
  radius,
  spacing,
} from '@hrm/design-tokens';
import { useColorScheme } from 'react-native';

export interface Theme {
  dark: boolean;
  colors: ColorTokens;
  spacing: typeof spacing;
  radius: typeof radius;
  fontSize: typeof fontSize;
  fontWeight: typeof fontWeight;
}

export function buildTheme(scheme: 'light' | 'dark'): Theme {
  return { dark: scheme === 'dark', colors: colors[scheme], spacing, radius, fontSize, fontWeight };
}

const light = buildTheme('light');
const dark = buildTheme('dark');

/** Theme from the shared design tokens, following the OS appearance setting. */
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

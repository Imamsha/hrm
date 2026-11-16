import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text as RNText,
  type TextProps,
  View,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/theme/theme';

type TextVariant = 'title' | 'heading' | 'body' | 'caption' | 'label';

/** Native text primitive mapped to the shared type scale (mobile sizes run one step larger). */
export function Text({
  variant = 'body',
  muted,
  style,
  ...props
}: TextProps & { variant?: TextVariant; muted?: boolean }) {
  const t = useTheme();
  const map = {
    title: {
      fontSize: t.fontSize['2xl'][0],
      lineHeight: t.fontSize['2xl'][1],
      fontWeight: t.fontWeight.semibold,
    },
    heading: {
      fontSize: t.fontSize.lg[0],
      lineHeight: t.fontSize.lg[1],
      fontWeight: t.fontWeight.semibold,
    },
    body: {
      fontSize: t.fontSize.md[0] + 1,
      lineHeight: t.fontSize.md[1] + 2,
      fontWeight: t.fontWeight.regular,
    },
    label: {
      fontSize: t.fontSize.md[0],
      lineHeight: t.fontSize.md[1],
      fontWeight: t.fontWeight.medium,
    },
    caption: {
      fontSize: t.fontSize.sm[0] + 1,
      lineHeight: t.fontSize.sm[1] + 2,
      fontWeight: t.fontWeight.regular,
    },
  } as const;
  return (
    <RNText
      style={[
        map[variant],
        { color: muted ? t.colors.mutedForeground : t.colors.foreground },
        style,
      ]}
      {...props}
    />
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.colors.card, borderColor: t.colors.border, borderRadius: t.radius.xl },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function StatusPill({
  tone,
  label,
}: {
  tone: 'success' | 'destructive' | 'neutral';
  label: string;
}) {
  const t = useTheme();
  const color =
    tone === 'success'
      ? t.colors.success
      : tone === 'destructive'
        ? t.colors.destructive
        : t.colors.mutedForeground;
  return (
    <View accessibilityRole="text" accessibilityLabel={label} style={styles.pill}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text variant="caption">{label}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  loading,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'outline';
}) {
  const t = useTheme();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: Boolean(loading), disabled: Boolean(loading) }}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          borderRadius: t.radius.lg,
          backgroundColor: primary ? t.colors.primary : 'transparent',
          borderColor: primary ? t.colors.primary : t.colors.input,
          opacity: pressed || loading ? 0.85 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? t.colors.primaryForeground : t.colors.foreground} />
      ) : (
        <Text
          variant="label"
          style={{ color: primary ? t.colors.primaryForeground : t.colors.foreground }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  button: {
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});

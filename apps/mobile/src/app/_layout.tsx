import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth } from '@/features/auth/auth-store';
import { bootstrapSession } from '@/features/auth/session';
import { createQueryClient } from '@/lib/api';
import { useTheme } from '@/theme/theme';

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const t = useTheme();
  const status = useAuth((s) => s.status);

  useEffect(() => {
    void bootstrapSession();
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style={t.dark ? 'light' : 'dark'} />
        {status === 'loading' ? (
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: t.colors.background,
            }}
          >
            <ActivityIndicator color={t.colors.primary} accessibilityLabel="Loading your session" />
          </View>
        ) : (
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: t.colors.background },
              headerTintColor: t.colors.foreground,
              headerShadowVisible: false,
              contentStyle: { backgroundColor: t.colors.background },
            }}
          >
            <Stack.Protected guard={status === 'authenticated'}>
              <Stack.Screen name="index" options={{ title: 'HRM Platform' }} />
              <Stack.Screen name="status" options={{ title: 'System status' }} />
            </Stack.Protected>
            <Stack.Protected guard={status === 'anonymous'}>
              <Stack.Screen name="login" options={{ headerShown: false }} />
            </Stack.Protected>
          </Stack>
        )}
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

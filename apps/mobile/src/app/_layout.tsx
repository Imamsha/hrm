import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createQueryClient } from '@/lib/api';
import { useTheme } from '@/theme/theme';

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const t = useTheme();

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style={t.dark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: t.colors.background },
            headerTintColor: t.colors.foreground,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: t.colors.background },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'HRM Platform' }} />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

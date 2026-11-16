import type { HealthReport } from '@hrm/shared-types';
import { useQuery } from '@tanstack/react-query';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, StatusPill, Text } from '@/components/primitives';
import { api, apiBaseUrl, errorMessage } from '@/lib/api';
import { useTheme } from '@/theme/theme';

const labels: Record<keyof HealthReport['checks'], string> = {
  database: 'PostgreSQL',
  redis: 'Redis',
  queue: 'Job queue',
  storage: 'Object storage',
};

export function HealthScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data, error, isPending, isRefetching, refetch } = useQuery({
    queryKey: ['health', 'report'],
    queryFn: ({ signal }) => api.health.report(signal),
    refetchInterval: 30_000,
  });

  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => void refetch()}
          tintColor={t.colors.primary}
        />
      }
    >
      <Text variant="title">System status</Text>
      <Text muted>Live health of the HRM API and its dependencies.</Text>

      {isPending ? (
        <Card>
          <Text muted>Checking API…</Text>
        </Card>
      ) : error ? (
        <Card>
          <Text variant="heading">API unreachable</Text>
          <Text muted>{errorMessage(error)}</Text>
          <Button label="Try again" onPress={() => void refetch()} />
        </Card>
      ) : (
        <>
          <Card>
            <View style={styles.row}>
              <Text variant="heading">Overall</Text>
              <StatusPill
                tone={data.status === 'ok' ? 'success' : 'destructive'}
                label={data.status === 'ok' ? 'Operational' : 'Degraded'}
              />
            </View>
            <Text variant="caption" muted>
              v{data.version} · {data.environment}
            </Text>
          </Card>
          <Card>
            {(Object.keys(labels) as (keyof HealthReport['checks'])[]).map((key) => {
              const check = data.checks[key];
              return (
                <View key={key} style={styles.row} testID={`dependency-${key}`}>
                  <Text variant="label">{labels[key]}</Text>
                  <View style={styles.right}>
                    <Text variant="caption" muted>
                      {check.latencyMs} ms
                    </Text>
                    <StatusPill
                      tone={check.status === 'up' ? 'success' : 'destructive'}
                      label={check.status === 'up' ? 'Up' : 'Down'}
                    />
                  </View>
                </View>
              );
            })}
          </Card>
        </>
      )}
      <Text variant="caption" muted>
        {apiBaseUrl}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 28,
  },
  right: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});

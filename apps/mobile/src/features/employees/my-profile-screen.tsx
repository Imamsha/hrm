import type { EmployeeDetails } from '@hrm/shared-types';
import { ApiClientError } from '@hrm/api-client';
import { useQuery } from '@tanstack/react-query';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Text } from '@/components/primitives';
import { api, errorMessage } from '@/lib/api';
import { useTheme } from '@/theme/theme';

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.row}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <Text>{value ?? '—'}</Text>
    </View>
  );
}

/** Read-only self-service profile (editing is on the web app until Phase 13). */
export function MyProfileScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { data, error, isPending, isRefetching, refetch } = useQuery({
    queryKey: ['me', 'employee'],
    queryFn: () => api.get<EmployeeDetails>('/me/employee'),
  });
  const notLinked = error instanceof ApiClientError && error.status === 404;

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
      <Text variant="title">My profile</Text>
      {isPending ? (
        <Text muted>Loading…</Text>
      ) : notLinked ? (
        <Card>
          <Text variant="heading">No employee record</Text>
          <Text muted>Your account is not linked to an employee record yet. Contact HR.</Text>
        </Card>
      ) : error ? (
        <Card>
          <Text variant="heading">Could not load your profile</Text>
          <Text muted>{errorMessage(error)}</Text>
          <Button label="Try again" variant="outline" onPress={() => void refetch()} />
        </Card>
      ) : (
        <>
          <Card>
            <Text variant="heading">{data.displayName}</Text>
            <Text muted>{data.employeeNumber}</Text>
          </Card>
          <Card>
            <Row label="Designation" value={data.job?.designation?.name} />
            <Row label="Department" value={data.job?.department?.name} />
            <Row label="Company" value={data.job?.company.name} />
            <Row label="Reporting manager" value={data.job?.manager?.displayName} />
            <Row label="Date of joining" value={data.dateOfJoining} />
          </Card>
          <Card>
            <Row label="Work e-mail" value={data.workEmail} />
            <Row label="Work phone" value={data.workPhone} />
            <Row label="Personal phone" value={data.personal?.personalPhone} />
          </Card>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  row: { gap: 2 },
});

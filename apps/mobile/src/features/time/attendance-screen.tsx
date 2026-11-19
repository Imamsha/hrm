import type { TodayAttendance } from '@hrm/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Text } from '@/components/primitives';
import { api, errorMessage } from '@/lib/api';
import { useTheme } from '@/theme/theme';

const time = (iso: string | null, timeZone: string) =>
  iso
    ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone })
    : '—';

const hm = (m: number) => `${String(Math.floor(m / 60))}h ${String(m % 60)}m`;

/** Clock in/out from the phone and see today's status. */
export function AttendanceScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const today = useQuery({
    queryKey: ['time', 'today'],
    queryFn: () => api.get<TodayAttendance>('/me/attendance/today'),
  });
  const punch = useMutation({
    mutationFn: () => api.post<TodayAttendance>('/me/attendance/punches', { source: 'MOBILE' }),
    onSuccess: (data) => {
      queryClient.setQueryData(['time', 'today'], data);
    },
  });

  const d = today.data;
  // Location capture needs a native module (planned with Phase 13); until then the app says so.
  const blocked = d ? !d.allowed.mobile || d.allowed.geolocationRequired : false;
  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      refreshControl={
        <RefreshControl
          refreshing={today.isRefetching}
          onRefresh={() => void today.refetch()}
          tintColor={t.colors.primary}
        />
      }
    >
      <Text variant="title">Attendance</Text>
      {today.isPending ? (
        <Text muted>Loading…</Text>
      ) : today.error ? (
        <Card>
          <Text variant="heading">Could not load today</Text>
          <Text muted>{errorMessage(today.error)}</Text>
        </Card>
      ) : d ? (
        <>
          <Card>
            <Text variant="caption" muted>
              Today
            </Text>
            <Text variant="heading">
              {d.day.shift
                ? `${d.day.shift.name} ${time(d.day.scheduledStart, d.timeZone)}–${time(d.day.scheduledEnd, d.timeZone)}`
                : 'No shift'}
            </Text>
            <Text muted>
              In {time(d.day.firstIn, d.timeZone)} · Out {time(d.day.lastOut, d.timeZone)} ·{' '}
              {hm(d.day.workedMinutes)}
            </Text>
          </Card>
          {blocked ? (
            <Card>
              <Text muted>
                {d.allowed.mobile
                  ? 'Your organization requires your location to clock in; use the web app or the kiosk QR code.'
                  : 'Clocking in from the app is disabled; use the kiosk QR code.'}
              </Text>
            </Card>
          ) : (
            <Button
              label={d.nextDirection === 'IN' ? 'Clock in' : 'Clock out'}
              loading={punch.isPending}
              onPress={() => {
                punch.mutate();
              }}
            />
          )}
          {punch.error ? <Text muted>{errorMessage(punch.error)}</Text> : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ content: { padding: 16, gap: 12 } });

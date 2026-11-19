import type {
  ApprovalInbox,
  AttendanceRangeItem,
  AttendanceStatusValue,
  AttendanceSummaryItem,
  KioskToken,
  LeaveBalanceItem,
  LeaveRequestItem,
  LeaveTypeItem,
  PaginatedResult,
  RegularizationItem,
  ShiftAssignmentItem,
  ShiftItem,
  TimeSettingsItem,
  TodayAttendance,
} from '@hrm/shared-types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type Params = Record<string, string | number | boolean | undefined>;

/** Every time & attendance query lives under this key (one invalidation refreshes all). */
export const TIME = ['time'] as const;

export const useToday = () =>
  useQuery({
    queryKey: [...TIME, 'today'],
    queryFn: () => api.get<TodayAttendance>('/me/attendance/today'),
  });

export function useAttendanceRange(base: string, from: string, to: string) {
  return useQuery({
    queryKey: [...TIME, 'range', base, from, to],
    queryFn: () => api.get<AttendanceRangeItem>(base, { query: { from, to } }),
    placeholderData: keepPreviousData,
  });
}

export const useMyRegularizations = () =>
  useQuery({
    queryKey: [...TIME, 'my-regularizations'],
    queryFn: () => api.get<RegularizationItem[]>('/me/attendance/regularizations'),
  });

export const useSummary = (q: Params) =>
  useQuery({
    queryKey: [...TIME, 'summary', q],
    queryFn: () => api.get<AttendanceSummaryItem>('/attendance/summary', { query: q }),
    placeholderData: keepPreviousData,
  });

export const useTimeSettings = () =>
  useQuery({
    queryKey: [...TIME, 'settings'],
    queryFn: () => api.get<TimeSettingsItem>('/attendance/settings'),
  });

export const useLeaveTypes = (includeInactive = false) =>
  useQuery({
    queryKey: [...TIME, 'leave-types', includeInactive],
    queryFn: () => api.get<LeaveTypeItem[]>('/leave/types', { query: { includeInactive } }),
  });

export const useBalances = (base: string, year?: number) =>
  useQuery({
    queryKey: [...TIME, 'balances', base, year],
    queryFn: () => api.get<LeaveBalanceItem[]>(base, { query: { year } }),
  });

export function useLeaveRequests(path: string, q: Params) {
  return useQuery<PaginatedResult<LeaveRequestItem>>({
    queryKey: [...TIME, 'leave-requests', path, q],
    queryFn: () => api.getPage<LeaveRequestItem>(path, { query: q }),
    placeholderData: keepPreviousData,
  });
}

export const useInbox = () =>
  useQuery({
    queryKey: [...TIME, 'inbox'],
    queryFn: () => api.get<ApprovalInbox>('/me/approvals'),
  });

export const useShifts = () =>
  useQuery({ queryKey: [...TIME, 'shifts'], queryFn: () => api.get<ShiftItem[]>('/shifts') });

export function useAssignments(q: Params) {
  return useQuery<PaginatedResult<ShiftAssignmentItem>>({
    queryKey: [...TIME, 'assignments', q],
    queryFn: () => api.getPage<ShiftAssignmentItem>('/shift-assignments', { query: q }),
    placeholderData: keepPreviousData,
  });
}

export function useKioskToken(branchId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...TIME, 'kiosk', branchId],
    queryFn: () => api.get<KioskToken>(`/attendance/kiosk/${branchId}/token`),
    enabled,
    // Refresh shortly after each rotation.
    refetchInterval: (q) => Math.max(5, (q.state.data?.rotatesInSeconds ?? 30) + 1) * 1000,
    refetchIntervalInBackground: true,
  });
}

// ------------------------------------------------------------------------------ formatting

export const STATUS_STYLE: Record<
  AttendanceStatusValue,
  { label: string; cls: string; dot: string }
> = {
  PRESENT: { label: 'Present', cls: 'bg-success/10', dot: 'bg-success' },
  HALF_DAY: { label: 'Half day', cls: 'bg-warning/15', dot: 'bg-warning' },
  ABSENT: { label: 'Absent', cls: 'bg-destructive/10', dot: 'bg-destructive' },
  ON_LEAVE: { label: 'On leave', cls: 'bg-info/10', dot: 'bg-info' },
  WEEKLY_OFF: {
    label: 'Weekly off',
    cls: 'bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground',
  },
  HOLIDAY: { label: 'Holiday', cls: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
  PENDING: { label: 'Pending', cls: 'bg-background', dot: 'bg-border' },
};

export function hm(minutes: number): string {
  if (!minutes) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${String(h)}h ${String(m)}m` : `${String(h)}h`;
}

export function clock(iso: string | null, timeZone?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export function currentMonth(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const SESSION_LABEL = {
  FULL: 'Full day',
  FIRST_HALF: 'First half',
  SECOND_HALF: 'Second half',
} as const;

export const REQUEST_VARIANT = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'destructive',
  CANCELLED: 'neutral',
} as const;

/** Local wall time `YYYY-MM-DDTHH:MM` (datetime-local input) → ISO with the browser's offset. */
export function localToIso(value: string): string {
  return new Date(value).toISOString();
}

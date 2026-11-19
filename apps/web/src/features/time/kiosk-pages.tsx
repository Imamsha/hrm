import type { TodayAttendance } from '@hrm/shared-types';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Select,
  Skeleton,
} from '@hrm/ui-web';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, QrCode } from 'lucide-react';
import { toDataURL } from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { useRefOptions } from '@/features/structure/api';
import { api, errorMessage } from '@/lib/api';
import { clock, useKioskToken } from './time-api';

/** Opened by scanning a kiosk QR code: records a QR punch for the signed-in employee. */
export function QrClockInPage() {
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const started = useRef(false);
  const punch = useMutation({
    mutationFn: () => api.post<TodayAttendance>('/me/attendance/punches', { qrToken: token }),
  });
  useEffect(() => {
    // One punch per scan, even under React strict-mode double effects.
    if (token && !started.current) {
      started.current = true;
      punch.mutate();
    }
  }, [token, punch]);

  const last = punch.data?.punches.at(-1);
  return (
    <Page className="max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle>QR clock-in</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          {!token ? (
            <Alert tone="warning">
              This link has no QR code. Scan the code shown at your office kiosk.
            </Alert>
          ) : punch.isPending ? (
            <p className="text-muted-foreground">Recording your punch…</p>
          ) : punch.isError ? (
            <Alert tone="destructive">{errorMessage(punch.error)}</Alert>
          ) : last ? (
            <div className="flex items-center gap-2 text-md">
              <CheckCircle2 className="size-5 text-success" />
              <span>
                Clocked {last.direction === 'IN' ? 'in' : 'out'} at{' '}
                {clock(last.punchedAt, punch.data?.timeZone)}
              </span>
            </div>
          ) : null}
          <Link className="text-primary hover:underline" to="/me/attendance">
            Go to my attendance
          </Link>
        </CardContent>
      </Card>
    </Page>
  );
}

function QrImage({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void toDataURL(text, { margin: 1, width: 320 }).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [text]);
  return src ? (
    <img
      src={src}
      alt="Clock-in QR code"
      width={320}
      height={320}
      className="rounded-md border border-border bg-white p-2"
    />
  ) : (
    <Skeleton className="size-80" />
  );
}

/** Kiosk display: a rotating QR code employees scan with their phone to clock in or out. */
export function KioskPage() {
  const [branchId, setBranchId] = useState('');
  const [running, setRunning] = useState(false);
  const branches = useRefOptions({ path: '/branches' }, { status: 'ACTIVE' });
  const token = useKioskToken(branchId, running && Boolean(branchId));
  return (
    <Page className="max-w-3xl">
      <PageHeader
        title="Attendance kiosk"
        description="Show this screen at the entrance. The code changes every few seconds, so photos of it stop working quickly."
      />
      {!running ? (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 pt-4">
            <FormField label="Branch" className="w-72">
              <Select
                value={branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                }}
                options={branches.data ?? []}
              />
            </FormField>
            <Button
              disabled={!branchId}
              onClick={() => {
                setRunning(true);
              }}
            >
              <QrCode /> Start kiosk
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              {token.data ? `${token.data.branch.name} — scan to clock in or out` : 'Starting…'}
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRunning(false);
              }}
            >
              Stop
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3 py-6">
            {token.isError ? (
              <Alert tone="destructive">{errorMessage(token.error)}</Alert>
            ) : token.data ? (
              <>
                <QrImage text={token.data.url} />
                <p className="text-sm text-muted-foreground">
                  Refreshes automatically · sign in on your phone first
                </p>
              </>
            ) : (
              <Skeleton className="size-80" />
            )}
          </CardContent>
        </Card>
      )}
    </Page>
  );
}

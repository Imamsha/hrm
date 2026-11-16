import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@hrm/ui-web';
import { Activity, BookOpen } from 'lucide-react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { useHealthReport } from '@/features/system/use-health';
import { env } from '@/lib/env';

/** API docs live next to the versioned API prefix: `/api/v1` -> `/api/docs`. */
const docsUrl = env.apiBaseUrl.replace(/\/v\d+\/?$/, '/docs');

export function OverviewPage() {
  const { data, isPending, isError } = useHealthReport();

  return (
    <Page>
      <PageHeader
        title="Overview"
        description="Platform foundation. Business modules are delivered phase by phase."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Platform status</CardTitle>
              <CardDescription>Live result of the API health report.</CardDescription>
            </div>
            {isPending ? (
              <Skeleton className="h-5 w-24" />
            ) : isError ? (
              <Badge variant="destructive">API unreachable</Badge>
            ) : data.status === 'ok' ? (
              <Badge variant="success">Operational</Badge>
            ) : (
              <Badge variant="warning">Degraded</Badge>
            )}
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to="/system/status">
                <Activity /> View system status
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>API reference</CardTitle>
              <CardDescription>OpenAPI documentation for the versioned REST API.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-sm">
              {env.apiBaseUrl}
            </code>
            <Button asChild variant="outline" size="sm">
              <a href={docsUrl} target="_blank" rel="noreferrer">
                <BookOpen /> Open API docs
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}

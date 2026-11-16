import { Button, EmptyState, ErrorState } from '@hrm/ui-web';
import { Compass } from 'lucide-react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Page } from './layout/page';

export function NotFoundPage() {
  return (
    <Page>
      <EmptyState
        icon={<Compass />}
        title="Page not found"
        description="The page you are looking for does not exist or has moved."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/">Back to overview</Link>
          </Button>
        }
      />
    </Page>
  );
}

/** Route-level error boundary: keeps the shell usable when one page crashes. */
export function RouteErrorPage() {
  const error = useRouteError();
  const description = isRouteErrorResponse(error)
    ? `${String(error.status)} ${error.statusText}`
    : 'An unexpected error occurred while rendering this page.';
  return (
    <Page>
      <ErrorState
        title="This page failed to load"
        description={description}
        onRetry={() => {
          window.location.reload();
        }}
      />
    </Page>
  );
}

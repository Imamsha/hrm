import { Card } from '@hrm/ui-web';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** Centered card layout for sign-in, registration and recovery screens. */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-subtle px-4 py-10">
      <Link to="/login" className="mb-6 flex items-center gap-2" aria-label="HRM Platform">
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
        >
          H
        </span>
        <span className="text-lg font-semibold tracking-tight">HRM Platform</span>
      </Link>
      <Card className="w-full max-w-sm">
        <div className="px-6 pt-6 pb-2">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1 text-base text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="px-6 pt-3 pb-6">{children}</div>
      </Card>
      {footer ? <div className="mt-4 text-base text-muted-foreground">{footer}</div> : null}
    </div>
  );
}

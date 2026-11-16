import { AlertTriangle, Inbox, LoaderCircle } from 'lucide-react';
import type * as React from 'react';
import { cn } from '../lib/cn.js';
import { Button } from './button.js';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

export function Spinner({
  className,
  label = 'Loading',
  ...props
}: React.ComponentProps<'svg'> & { label?: string }) {
  return (
    <LoaderCircle
      role="status"
      aria-label={label}
      className={cn('size-4 animate-spin text-muted-foreground', className)}
      {...props}
    />
  );
}

export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<'div'> & { orientation?: 'horizontal' | 'vertical' }) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  );
}

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-muted px-1 font-sans text-xs text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

interface StateProps {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: StateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-4.5">
        {icon ?? <Inbox />}
      </div>
      <p className="text-md font-medium">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  className,
}: Partial<StateProps> & { onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="flex size-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive [&_svg]:size-4.5">
        <AlertTriangle />
      </div>
      <p className="text-md font-medium">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-1" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export type StatusTone = 'success' | 'warning' | 'destructive' | 'neutral' | 'info';

const toneClass: Record<StatusTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  neutral: 'bg-muted-foreground',
  info: 'bg-info',
};

/** Colored dot + text. Never color alone: the label carries the meaning for accessibility. */
export function StatusIndicator({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', toneClass[tone])} />
      {children}
    </span>
  );
}

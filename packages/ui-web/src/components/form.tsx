import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn.js';
import { Label } from './label.js';

export interface FormFieldProps {
  label: string;
  /** Wires the control via id, aria-invalid and aria-describedby. */
  children: React.ReactElement<{
    id?: string;
    'aria-invalid'?: boolean;
    'aria-describedby'?: string;
    'aria-required'?: boolean;
  }>;
  error?: string | undefined;
  description?: React.ReactNode;
  required?: boolean;
  className?: string;
}

/** Label + control + description + inline error, with accessible associations. */
export function FormField({
  label,
  children,
  error,
  description,
  required,
  className,
}: FormFieldProps) {
  const id = React.useId();
  const controlId = children.props.id ?? `${id}-control`;
  const descId = description ? `${id}-desc` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [descId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={controlId} required={required ?? false}>
        {label}
      </Label>
      {React.cloneElement(children, {
        id: controlId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        ...(required ? { 'aria-required': true } : {}),
      })}
      {description && !error ? (
        <p id={descId} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Responsive 1/2/3-column form grid. */
export function FormGrid({
  columns = 2,
  className,
  ...props
}: React.ComponentProps<'div'> & { columns?: 1 | 2 | 3 }) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-x-4 gap-y-4',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
      {...props}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Native select (best keyboard/mobile behaviour, no portal issues in dialogs). Always renders a
 * disabled placeholder so nothing is pre-selected unexpectedly.
 */
export function Select({
  options,
  placeholder = 'Select…',
  className,
  value,
  ...props
}: Omit<React.ComponentProps<'select'>, 'children'> & {
  options: SelectOption[];
  placeholder?: string;
}) {
  return (
    <select
      className={cn(
        'h-control w-full rounded-md border border-input bg-background px-2 text-base shadow-xs',
        'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
        value === '' || value === undefined ? 'text-muted-foreground' : 'text-foreground',
        className,
      )}
      value={value ?? ''}
      {...props}
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value} className="text-foreground">
          {o.label}
        </option>
      ))}
    </select>
  );
}

const alertTone = {
  info: { cls: 'border-info/30 bg-info/8 text-foreground [&_svg]:text-info', Icon: Info },
  success: {
    cls: 'border-success/30 bg-success/8 text-foreground [&_svg]:text-success',
    Icon: CheckCircle2,
  },
  warning: {
    cls: 'border-warning/30 bg-warning/10 text-foreground [&_svg]:text-warning',
    Icon: TriangleAlert,
  },
  destructive: {
    cls: 'border-destructive/30 bg-destructive/8 text-foreground [&_svg]:text-destructive',
    Icon: AlertCircle,
  },
} as const;

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: keyof typeof alertTone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { cls, Icon } = alertTone[tone];
  return (
    <div
      role={tone === 'destructive' ? 'alert' : 'status'}
      className={cn('flex gap-2.5 rounded-lg border px-3 py-2.5 text-base', cls, className)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? (
          <div className={cn(title && 'mt-0.5 text-muted-foreground')}>{children}</div>
        ) : null}
      </div>
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-semibold text-primary dark:bg-primary/30 dark:text-foreground',
        className,
      )}
    >
      {initials || '?'}
    </span>
  );
}

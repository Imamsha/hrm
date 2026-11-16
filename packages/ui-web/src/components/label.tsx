import { Label as LabelPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '../lib/cn.js';

export interface LabelProps extends React.ComponentProps<typeof LabelPrimitive.Root> {
  /** Shows the required indicator. Pair with `required`/`aria-required` on the control. */
  required?: boolean;
}

export function Label({ className, required, children, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex items-center gap-0.5 text-sm font-medium leading-none text-foreground select-none',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <span aria-hidden="true" className="text-destructive">
          *
        </span>
      ) : null}
    </LabelPrimitive.Root>
  );
}

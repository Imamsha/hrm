import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '../lib/cn.js';

export const badgeVariants = cva(
  'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-sm px-1.5 text-xs font-medium [&_svg]:size-3',
  {
    variants: {
      variant: {
        neutral: 'bg-muted text-muted-foreground',
        primary: 'bg-primary/12 text-primary dark:bg-primary/25 dark:text-foreground',
        success: 'bg-success/12 text-success dark:bg-success/18',
        warning: 'bg-warning/14 text-warning dark:bg-warning/18',
        destructive:
          'bg-destructive/12 text-destructive dark:bg-destructive/25 dark:text-foreground',
        info: 'bg-info/12 text-info dark:bg-info/18',
        outline: 'border border-border text-foreground',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends React.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

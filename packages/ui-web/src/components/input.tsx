import type * as React from 'react';
import { cn } from '../lib/cn.js';

export function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-control w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-base shadow-xs',
        'placeholder:text-muted-foreground transition-[border-color,box-shadow] duration-150',
        'focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  );
}

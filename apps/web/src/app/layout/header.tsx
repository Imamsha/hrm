import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
} from '@hrm/ui-web';
import type { Density } from '@hrm/design-tokens';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Menu, Monitor, Moon, SlidersHorizontal, Sun } from 'lucide-react';
import { Link, useMatches } from 'react-router';
import { api } from '@/lib/api';
import { type ThemePreference, usePreferences } from '@/stores/preferences';

export interface RouteHandle {
  crumb?: string;
}

function Breadcrumbs() {
  const matches = useMatches();
  const crumbs = matches
    .map((m) => ({ path: m.pathname, crumb: (m.handle as RouteHandle | undefined)?.crumb }))
    .filter((c): c is { path: string; crumb: string } => Boolean(c.crumb));

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1 text-base">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.path} className="flex min-w-0 items-center gap-1">
              {i > 0 ? (
                <ChevronRight
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : null}
              {last ? (
                <span aria-current="page" className="truncate font-medium">
                  {c.crumb}
                </span>
              ) : (
                <Link to={c.path} className="truncate text-muted-foreground hover:text-foreground">
                  {c.crumb}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Small live indicator of API reachability (liveness endpoint, polled). */
function ApiIndicator() {
  const { isSuccess, isError, isPending } = useQuery({
    queryKey: ['health', 'live'],
    queryFn: ({ signal }) => api.health.live(signal),
    refetchInterval: 30_000,
    retry: false,
  });
  const state = isPending ? 'Checking API…' : isSuccess ? 'API connected' : 'API unreachable';
  return (
    <Tooltip content={state}>
      <Link
        to="/system/status"
        aria-label={state}
        className="flex size-7 items-center justify-center rounded-md hover:bg-accent"
      >
        <span
          className={cn(
            'size-2 rounded-full',
            isPending && 'bg-muted-foreground',
            isSuccess && 'bg-success',
            isError && 'bg-destructive',
          )}
        />
      </Link>
    </Tooltip>
  );
}

const themeIcon = { light: Sun, dark: Moon, system: Monitor } as const;

function DisplayMenu() {
  const theme = usePreferences((s) => s.theme);
  const density = usePreferences((s) => s.density);
  const setTheme = usePreferences((s) => s.setTheme);
  const setDensity = usePreferences((s) => s.setDensity);
  const Icon = themeIcon[theme];

  return (
    <DropdownMenu>
      <Tooltip content="Display settings">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Display settings">
            <Icon />
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(v) => {
            setTheme(v as ThemePreference);
          }}
        >
          <DropdownMenuRadioItem value="light">
            <Sun /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Density</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={density}
          onValueChange={(v) => {
            setDensity(v as Density);
          }}
        >
          <DropdownMenuRadioItem value="compact">
            <SlidersHorizontal /> Compact
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="comfortable">
            <SlidersHorizontal /> Comfortable
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Header({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 md:px-4">
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        aria-label="Open navigation"
        onClick={onOpenMobileNav}
      >
        <Menu />
      </Button>
      <Breadcrumbs />
      <div className="ml-auto flex items-center gap-1">
        <ApiIndicator />
        <DisplayMenu />
      </div>
    </header>
  );
}

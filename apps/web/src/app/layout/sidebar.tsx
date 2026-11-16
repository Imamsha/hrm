import { cn, Tooltip } from '@hrm/ui-web';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { NavLink } from 'react-router';
import { navigation } from '@/app/navigation';
import { hasPermission, useAuth } from '@/features/auth/auth-store';
import { usePreferences } from '@/stores/preferences';

export function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn(
        'flex h-12 shrink-0 items-center gap-2 px-3',
        collapsed && 'justify-center px-0',
      )}
    >
      <div
        aria-hidden="true"
        className="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
      >
        H
      </div>
      {collapsed ? (
        <span className="sr-only">HRM Platform</span>
      ) : (
        <span className="text-md font-semibold tracking-tight">HRM Platform</span>
      )}
    </div>
  );
}

export function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const session = useAuth((s) => s.session);
  const sections = navigation
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => !item.permission || hasPermission(session, item.permission),
      ),
    }))
    .filter((section) => section.items.length > 0);
  return (
    <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-2">
      {sections.map((section) => (
        <div key={section.label} className="mb-3">
          {collapsed ? (
            <div className="mx-2 my-2 h-px bg-sidebar-border" aria-hidden="true" />
          ) : (
            <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-sidebar-muted">
              {section.label}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const link = (
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  onClick={onNavigate}
                  aria-label={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'flex h-8 items-center gap-2.5 rounded-md px-2 text-base text-sidebar-foreground transition-colors',
                      'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                      isActive && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
                      collapsed && 'justify-center px-0',
                    )
                  }
                >
                  <item.icon className="size-4 shrink-0" aria-hidden="true" />
                  {collapsed ? null : <span className="truncate">{item.label}</span>}
                </NavLink>
              );
              return (
                <li key={item.to}>
                  {collapsed ? (
                    <Tooltip content={item.label} side="right">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Desktop sidebar (md and up). Collapses to an icon rail. */
export function Sidebar() {
  const collapsed = usePreferences((s) => s.sidebarCollapsed);
  const toggle = usePreferences((s) => s.toggleSidebar);

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      <Brand collapsed={collapsed} />
      <SidebarNav collapsed={collapsed} />
      <div className="border-t border-sidebar-border p-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className={cn(
            'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {collapsed ? null : <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

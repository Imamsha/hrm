import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@hrm/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronsUpDown, LogOut, MonitorX, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/features/auth/auth-store';
import { signOut, switchOrganization } from '@/features/auth/session';
import { CreateOrganizationDialog } from '@/features/organization/create-organization-dialog';

/** Organization switcher: the active tenant is changed server-side and every cached query is dropped. */
export function OrganizationSwitcher() {
  const session = useAuth((s) => s.session);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  if (!session) return null;
  const active = session.activeOrganization;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="max-w-56 gap-2"
            aria-label="Switch organization"
          >
            <Building2 />
            <span className="truncate">{active?.organizationName ?? 'No organization'}</span>
            <ChevronsUpDown className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={active?.organizationId ?? ''}
            onValueChange={(id) => {
              if (id === active?.organizationId) return;
              void switchOrganization(queryClient, id).then(() => navigate('/'));
            }}
          >
            {session.memberships.map((m) => (
              <DropdownMenuRadioItem key={m.organizationId} value={m.organizationId}>
                <span className="truncate">{m.organizationName}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setCreating(true);
            }}
          >
            <Plus /> New organization
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateOrganizationDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

export function UserMenu() {
  const session = useAuth((s) => s.session);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  if (!session) return null;
  const { user } = session;

  const logout = (everywhere: boolean) => {
    void signOut(queryClient, everywhere).then(() => navigate('/login', { replace: true }));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar name={user.fullName} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="px-2 py-1.5">
          <p className="truncate text-base font-medium">{user.fullName}</p>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void navigate('/account/security')}>
          <ShieldCheck /> Security
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            logout(false);
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            logout(true);
          }}
        >
          <MonitorX /> Sign out of all devices
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { type MemberListItem, PERMISSIONS } from '@hrm/shared-types';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  type DataTableColumnDef,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  type PaginationState,
  Select,
  type SortingState,
} from '@hrm/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Search, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Page, PageHeader } from '@/app/layout/page';
import { useAuth, usePermission } from '@/features/auth/auth-store';
import { api, errorMessage } from '@/lib/api';
import { useMembersPage, usePendingInvitations, useRoles } from './api';
import { ChangeRolesDialog, ConfirmDialog, InviteMemberDialog } from './member-dialogs';

type PendingAction = { kind: 'suspend' | 'reactivate' | 'remove'; member: MemberListItem };

const getRowId = (m: MemberListItem) => m.membershipId;

function PendingInvitations() {
  const canInvite = usePermission(PERMISSIONS.USERS_MEMBER_INVITE);
  const invitations = usePendingInvitations(true);
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/invitations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invitations'] }),
  });
  if (!invitations.data?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending invitations</CardTitle>
        <Badge>{invitations.data.length}</Badge>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {invitations.data.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{inv.fullName ?? inv.email}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {inv.email} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {inv.roles.map((r) => (
                  <Badge key={r.id} variant="outline">
                    {r.name}
                  </Badge>
                ))}
              </div>
              {canInvite ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    revoke.mutate(inv.id);
                  }}
                  disabled={revoke.isPending}
                >
                  Revoke
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function MembersPage() {
  const queryClient = useQueryClient();
  const myMembershipId = useAuth((s) => s.session?.activeOrganization?.membershipId);
  const canInvite = usePermission(PERMISSIONS.USERS_MEMBER_INVITE);
  const canUpdate = usePermission(PERMISSIONS.USERS_MEMBER_UPDATE);
  const canRemove = usePermission(PERMISSIONS.USERS_MEMBER_REMOVE);

  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [sorting, setSorting] = useState<SortingState>([{ id: 'fullName', desc: false }]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'SUSPENDED'>('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Debounce typing; a new search starts again from the first page.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = search.trim();
      setDebouncedSearch((prev) => {
        if (prev !== next) setPagination((p) => ({ ...p, pageIndex: 0 }));
        return next;
      });
    }, 300);
    return () => {
      clearTimeout(t);
    };
  }, [search]);

  const sort = sorting[0];
  const members = useMembersPage({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    sortBy: sort?.id,
    sortDir: sort?.desc ? 'desc' : 'asc',
    search: debouncedSearch || undefined,
    status: status || undefined,
  });
  const roles = useRoles();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [rolesFor, setRolesFor] = useState<MemberListItem | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: (a: PendingAction) =>
      a.kind === 'remove'
        ? api.delete(`/members/${a.member.membershipId}`)
        : api.patch(`/members/${a.member.membershipId}`, {
            status: a.kind === 'suspend' ? 'SUSPENDED' : 'ACTIVE',
          }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['members'] });
      setPending(null);
    },
    onError: (err) => {
      setActionError(errorMessage(err));
    },
  });

  const columns = useMemo<DataTableColumnDef<MemberListItem>[]>(
    () => [
      {
        id: 'fullName',
        accessorKey: 'fullName',
        header: 'Name',
        size: 260,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar name={row.original.fullName} />
            <div className="min-w-0">
              <p className="truncate font-medium">
                {row.original.fullName}
                {row.original.membershipId === myMembershipId ? (
                  <span className="ml-1.5 text-sm font-normal text-muted-foreground">(you)</span>
                ) : null}
              </p>
              <p className="truncate text-sm text-muted-foreground">{row.original.email}</p>
            </div>
          </div>
        ),
      },
      {
        id: 'roles',
        header: 'Roles',
        size: 220,
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.roles.map((r) => (
              <Badge key={r.id} variant={r.key === 'owner' ? 'primary' : 'neutral'}>
                {r.name}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: 'Status',
        size: 110,
        cell: ({ row }) =>
          row.original.status === 'ACTIVE' ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="warning">Suspended</Badge>
          ),
      },
      {
        id: 'mfa',
        header: '2FA',
        size: 70,
        enableSorting: false,
        cell: ({ row }) =>
          row.original.mfaEnabled ? (
            <Badge variant="success">On</Badge>
          ) : (
            <span className="text-muted-foreground">Off</span>
          ),
      },
      {
        id: 'joinedAt',
        accessorKey: 'joinedAt',
        header: 'Joined',
        size: 120,
        meta: { numeric: true },
        cell: ({ row }) => new Date(row.original.joinedAt).toLocaleDateString(),
      },
      {
        id: 'actions',
        header: '',
        size: 52,
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        cell: ({ row }) => {
          const m = row.original;
          const self = m.membershipId === myMembershipId;
          if (self || (!canUpdate && !canRemove)) return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.fullName}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canUpdate ? (
                  <>
                    <DropdownMenuItem
                      onSelect={() => {
                        setRolesFor(m);
                      }}
                    >
                      Change roles
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setActionError(null);
                        setPending({
                          kind: m.status === 'ACTIVE' ? 'suspend' : 'reactivate',
                          member: m,
                        });
                      }}
                    >
                      {m.status === 'ACTIVE' ? 'Suspend access' : 'Reactivate'}
                    </DropdownMenuItem>
                  </>
                ) : null}
                {canRemove ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => {
                        setActionError(null);
                        setPending({ kind: 'remove', member: m });
                      }}
                    >
                      Remove from organization
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [myMembershipId, canUpdate, canRemove],
  );

  const confirmCopy: Record<
    PendingAction['kind'],
    { title: string; description: string; label: string }
  > = {
    suspend: {
      title: 'Suspend access?',
      description: 'They will lose access to this organization immediately.',
      label: 'Suspend',
    },
    reactivate: {
      title: 'Reactivate member?',
      description: 'Their access will be restored with their current roles.',
      label: 'Reactivate',
    },
    remove: {
      title: 'Remove member?',
      description: 'They will be removed from this organization. Their account remains.',
      label: 'Remove',
    },
  };

  return (
    <Page>
      <PageHeader
        title="Members"
        description="People with access to this organization and their roles."
        actions={
          canInvite ? (
            <Button
              onClick={() => {
                setInviteOpen(true);
              }}
              disabled={!roles.data}
            >
              <UserPlus /> Invite member
            </Button>
          ) : null
        }
      />
      <div className="flex flex-col gap-4">
        <PendingInvitations />
        <DataTable
          aria-label="Members"
          mode="server"
          columns={columns}
          data={members.data?.items ?? []}
          getRowId={getRowId}
          rowCount={members.data?.pagination.total ?? 0}
          pagination={pagination}
          onPaginationChange={setPagination}
          sorting={sorting}
          onSortingChange={setSorting}
          isLoading={members.isPending}
          isFetching={members.isFetching}
          error={members.isError ? errorMessage(members.error) : null}
          onRetry={() => void members.refetch()}
          emptyTitle={
            debouncedSearch || status ? 'No members match your filters' : 'No members yet'
          }
          toolbar={
            <>
              <div className="relative w-full max-w-64">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  aria-label="Search members"
                  placeholder="Search name or e-mail"
                  className="h-7 pl-7"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                  }}
                />
              </div>
              <Select
                aria-label="Filter by status"
                className="h-7 w-36"
                placeholder="All statuses"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as typeof status);
                  setPagination((p) => ({ ...p, pageIndex: 0 }));
                }}
                options={[
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'SUSPENDED', label: 'Suspended' },
                ]}
              />
              {status ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStatus('');
                    setPagination((p) => ({ ...p, pageIndex: 0 }));
                  }}
                >
                  Clear
                </Button>
              ) : null}
            </>
          }
        />
      </div>

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} roles={roles.data ?? []} />
      <ChangeRolesDialog
        member={rolesFor}
        onClose={() => {
          setRolesFor(null);
        }}
        roles={roles.data ?? []}
      />
      {pending ? (
        <ConfirmDialog
          open
          title={confirmCopy[pending.kind].title}
          description={`${pending.member.fullName}: ${confirmCopy[pending.kind].description}`}
          confirmLabel={confirmCopy[pending.kind].label}
          destructive={pending.kind !== 'reactivate'}
          pending={act.isPending}
          error={actionError}
          onConfirm={() => {
            act.mutate(pending);
          }}
          onOpenChange={(o) => {
            if (!o) setPending(null);
          }}
        />
      ) : null}
    </Page>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import type {
  InvitationItem,
  MemberListItem,
  RoleDetails,
  ScopedRoleAssignment,
} from '@hrm/shared-types';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  FormGrid,
  Input,
  Select,
} from '@hrm/ui-web';
import { inviteMemberSchema } from '@hrm/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useRefOptions } from '@/features/structure/api';
import { api, errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';

function RolePicker({
  roles,
  value,
  onChange,
  invalid,
}: {
  roles: RoleDetails[];
  value: string[];
  onChange: (ids: string[]) => void;
  invalid?: boolean;
}) {
  return (
    <fieldset
      aria-invalid={invalid}
      className="flex flex-col gap-1 rounded-md border border-input p-1"
    >
      <legend className="sr-only">Roles</legend>
      {roles.map((role) => {
        const id = `role-${role.id}`;
        const checked = value.includes(role.id);
        return (
          <label
            key={role.id}
            htmlFor={id}
            className="flex cursor-pointer items-start gap-2.5 rounded-sm px-2 py-1.5 hover:bg-accent"
          >
            <Checkbox
              id={id}
              className="mt-0.5"
              checked={checked}
              onCheckedChange={(v) => {
                onChange(v === true ? [...value, role.id] : value.filter((x) => x !== role.id));
              }}
            />
            <span className="min-w-0">
              <span className="block font-medium">{role.name}</span>
              {role.description ? (
                <span className="block text-sm text-muted-foreground">{role.description}</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

const inviteFormSchema = inviteMemberSchema.extend({ fullName: z.string().trim().max(200) });
type InviteValues = z.input<typeof inviteFormSchema>;

export function InviteMemberDialog({
  open,
  onOpenChange,
  roles,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  roles: RoleDetails[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Invite a member"
          description="They will receive an e-mail link to join this organization."
        />
        {/* Mounted only while open, so every opening starts with an empty form. */}
        <InviteForm
          roles={roles}
          onDone={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({ roles, onDone }: { roles: RoleDetails[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  // No role is pre-selected: the inviter makes an explicit choice.
  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: { email: '', fullName: '', roleIds: [] },
  });
  const invite = useMutation({
    mutationFn: (v: InviteValues) =>
      api.post<InvitationItem>('/invitations', { ...v, fullName: v.fullName || undefined }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['invitations'] });
      onDone();
    },
    onError: (err) => {
      setFormError(applyServerErrors(err, form.setError, ['email', 'fullName', 'roleIds']));
    },
  });
  const { errors } = form.formState;
  return (
    <form
      noValidate
      onSubmit={(e) =>
        void form.handleSubmit((v) => {
          invite.mutate(v);
        })(e)
      }
    >
      <DialogBody className="flex flex-col gap-4">
        {formError ? <Alert tone="destructive">{formError}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Email" error={errors.email?.message} required>
            <Input type="email" autoFocus {...form.register('email')} />
          </FormField>
          <FormField label="Full name" error={errors.fullName?.message}>
            <Input {...form.register('fullName')} />
          </FormField>
        </FormGrid>
        <FormField label="Roles" error={errors.roleIds?.message} required>
          <Controller
            control={form.control}
            name="roleIds"
            render={({ field }) => (
              <RolePicker
                roles={roles}
                value={field.value}
                onChange={field.onChange}
                invalid={Boolean(errors.roleIds)}
              />
            )}
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={invite.isPending} aria-busy={invite.isPending}>
          Send invitation
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ChangeRolesDialog({
  member,
  onClose,
  roles,
}: {
  member: MemberListItem | null;
  onClose: () => void;
  roles: RoleDetails[];
}) {
  return (
    <Dialog
      open={member !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader
          title="Change roles"
          description={member ? `${member.fullName} · ${member.email}` : undefined}
        />
        {member ? <ChangeRolesForm member={member} roles={roles} onDone={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ChangeRolesForm({
  member,
  roles,
  onDone,
}: {
  member: MemberListItem;
  roles: RoleDetails[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>(() => member.roles.map((r) => r.id));
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.put(`/members/${member.membershipId}/roles`, { roleIds: selected }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['members'] });
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      onDone();
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <RolePicker roles={roles} value={selected} onChange={setSelected} />
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            save.mutate();
          }}
          disabled={selected.length === 0 || save.isPending}
        >
          Save roles
        </Button>
      </DialogFooter>
    </>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
  onOpenChange,
  pending,
  error,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onOpenChange: (o: boolean) => void;
  pending?: boolean;
  error?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" role="alertdialog">
        <DialogHeader title={title} description={description} />
        {error ? (
          <DialogBody>
            <Alert tone="destructive">{error}</Alert>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={pending}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SCOPE_SOURCES = {
  COMPANY: { label: 'Company', path: '/companies' },
  BRANCH: { label: 'Branch', path: '/branches' },
  DEPARTMENT: { label: 'Department (and sub-departments)', path: '/departments' },
  TEAM: { label: 'Team', path: '/teams' },
} as const;
type ScopeKind = keyof typeof SCOPE_SOURCES;

function scopeLabel(a: ScopedRoleAssignment): string {
  if (a.scopeType === 'ORGANIZATION') return 'Whole organization';
  const kind = `${a.scopeType.charAt(0)}${a.scopeType.slice(1).toLowerCase()}`;
  return `${kind}: ${a.scope ? `${a.scope.name} (${a.scope.code})` : 'removed'}`;
}

/** Lists a member's role assignments and adds roles limited to a company, branch, department or team. */
export function RoleAssignmentsDialog({
  member,
  onClose,
  roles,
}: {
  member: MemberListItem | null;
  onClose: () => void;
  roles: RoleDetails[];
}) {
  return (
    <Dialog
      open={member !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent size="lg">
        <DialogHeader
          title="Scoped roles"
          description={
            member
              ? `${member.fullName}: roles that apply only within part of the organization.`
              : undefined
          }
        />
        {member ? <RoleAssignmentsBody member={member} roles={roles} onDone={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function RoleAssignmentsBody({
  member,
  roles,
  onDone,
}: {
  member: MemberListItem;
  roles: RoleDetails[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const key = ['members', member.membershipId, 'role-assignments'];
  const assignments = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<ScopedRoleAssignment[]>(`/members/${member.membershipId}/role-assignments`),
  });
  const [roleId, setRoleId] = useState('');
  const [scopeType, setScopeType] = useState<ScopeKind>('DEPARTMENT');
  const [scopeId, setScopeId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const source = SCOPE_SOURCES[scopeType];
  const targets = useRefOptions({ path: source.path }, { status: 'ACTIVE' });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['members'] });
  };
  const add = useMutation({
    mutationFn: () =>
      api.post(`/members/${member.membershipId}/role-assignments`, { roleId, scopeType, scopeId }),
    onSuccess: async () => {
      setRoleId('');
      setScopeId('');
      setError(null);
      await refresh();
    },
    onError: (err) => {
      setError(errorMessage(err));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/members/${member.membershipId}/role-assignments/${id}`),
    onSuccess: refresh,
    onError: (err) => {
      setError(errorMessage(err));
    },
  });
  // The owner role is organization-wide only (enforced by the API as well).
  const assignable = roles.filter((r) => r.key !== 'owner');

  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        {assignments.isPending ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : assignments.isError ? (
          <Alert tone="destructive">{errorMessage(assignments.error)}</Alert>
        ) : (
          <ul
            className="divide-y divide-border rounded-md border border-border"
            aria-label="Current assignments"
          >
            {assignments.data.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{a.role.name}</span>
                  <span className="block text-sm text-muted-foreground">{scopeLabel(a)}</span>
                </span>
                {a.scopeType !== 'ORGANIZATION' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove ${a.role.name} for ${a.scope?.name ?? 'scope'}`}
                    disabled={remove.isPending}
                    onClick={() => {
                      remove.mutate(a.id);
                    }}
                  >
                    Remove
                  </Button>
                ) : (
                  <span className="text-sm text-muted-foreground">Managed in Change roles</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
          <legend className="px-1 font-medium">Add a scoped role</legend>
          <FormGrid columns={3}>
            <FormField label="Role" required>
              <Select
                value={roleId}
                onChange={(e) => {
                  setRoleId(e.target.value);
                }}
                options={assignable.map((r) => ({ value: r.id, label: r.name }))}
              />
            </FormField>
            <FormField label="Applies to" required>
              <Select
                value={scopeType}
                onChange={(e) => {
                  setScopeType(e.target.value as ScopeKind);
                  setScopeId('');
                }}
                options={Object.entries(SCOPE_SOURCES).map(([value, s]) => ({
                  value,
                  label: s.label,
                }))}
              />
            </FormField>
            <FormField label={source.label.replace(/ \(.*\)$/, '')} required>
              <Select
                value={scopeId}
                disabled={targets.isPending}
                onChange={(e) => {
                  setScopeId(e.target.value);
                }}
                placeholder={targets.isPending ? 'Loading…' : 'Select…'}
                options={targets.data ?? []}
              />
            </FormField>
          </FormGrid>
          <p className="text-sm text-muted-foreground">
            A scoped role applies to records inside that part of the organization as each module
            adopts it. Organization-wide screens still require an organization-wide role.
          </p>
          <div>
            <Button
              size="sm"
              disabled={!roleId || !scopeId || add.isPending}
              onClick={() => {
                add.mutate();
              }}
            >
              Add assignment
            </Button>
          </div>
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}

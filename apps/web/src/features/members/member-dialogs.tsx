import { zodResolver } from '@hookform/resolvers/zod';
import type { InvitationItem, MemberListItem, RoleDetails } from '@hrm/shared-types';
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
} from '@hrm/ui-web';
import { inviteMemberSchema } from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
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

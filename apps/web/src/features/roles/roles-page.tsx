import { zodResolver } from '@hookform/resolvers/zod';
import { type PermissionCatalogItem, PERMISSIONS, type RoleDetails } from '@hrm/shared-types';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  DataTable,
  type DataTableColumnDef,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  FormField,
  FormGrid,
  Input,
} from '@hrm/ui-web';
import { optionalText, requiredText, roleKeySchema } from '@hrm/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { loadSession } from '@/features/auth/session';
import { ConfirmDialog } from '@/features/members/member-dialogs';
import { usePermissionCatalog, useRoles } from '@/features/members/api';
import { api, errorMessage } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';

const roleFormSchema = z.object({
  key: roleKeySchema,
  name: requiredText(100),
  description: optionalText(500),
  permissions: z.array(z.string()),
});
type RoleValues = z.input<typeof roleFormSchema>;

function PermissionMatrix({
  catalog,
  value,
  onChange,
  disabled,
}: {
  catalog: PermissionCatalogItem[];
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const modules = useMemo(() => {
    const map = new Map<string, PermissionCatalogItem[]>();
    for (const p of catalog) map.set(p.module, [...(map.get(p.module) ?? []), p]);
    return [...map.entries()];
  }, [catalog]);
  return (
    <div className="flex flex-col gap-3">
      {modules.map(([module, items]) => (
        <fieldset key={module} className="rounded-md border border-border">
          <legend className="ml-2 px-1 text-sm font-medium capitalize">{module}</legend>
          <div className="grid grid-cols-1 gap-0.5 p-1 sm:grid-cols-2">
            {items.map((p) => {
              const id = `perm-${p.key}`;
              return (
                <label
                  key={p.key}
                  htmlFor={id}
                  className="flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 hover:bg-accent"
                >
                  <Checkbox
                    id={id}
                    className="mt-0.5"
                    disabled={disabled}
                    checked={value.includes(p.key)}
                    onCheckedChange={(v) => {
                      onChange(v === true ? [...value, p.key] : value.filter((k) => k !== p.key));
                    }}
                  />
                  <span className="min-w-0">
                    <span className="block">{p.description}</span>
                    <code className="block text-xs text-muted-foreground">{p.key}</code>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function RoleEditor({
  role,
  open,
  onOpenChange,
  catalog,
  readOnly,
}: {
  role: RoleDetails | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  catalog: PermissionCatalogItem[];
  readOnly: boolean;
}) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  // The parent remounts this component (new `key`) every time the editor opens.
  const form = useForm<RoleValues>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: role
      ? {
          key: role.key,
          name: role.name,
          description: role.description ?? '',
          permissions: role.permissions,
        }
      : { key: '', name: '', description: '', permissions: [] },
  });

  const save = useMutation({
    mutationFn: (v: RoleValues) =>
      role
        ? api.patch<RoleDetails>(`/roles/${role.id}`, {
            name: v.name,
            description: v.description,
            permissions: v.permissions,
          })
        : api.post<RoleDetails>('/roles', v),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      await loadSession(); // own permissions may have changed
      onOpenChange(false);
    },
    onError: (err) => {
      setFormError(
        applyServerErrors(err, form.setError, ['key', 'name', 'description', 'permissions']),
      );
    },
  });

  const locked = readOnly || Boolean(role?.isSystem);
  const { errors } = form.formState;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader
          title={role ? role.name : 'New role'}
          description={
            role?.isSystem
              ? 'System role — permissions are managed by the platform.'
              : 'Choose what members with this role can do.'
          }
        />
        <form
          noValidate
          onSubmit={(e) =>
            void form.handleSubmit((v) => {
              save.mutate(v);
            })(e)
          }
          className="contents"
        >
          <DialogBody className="flex flex-col gap-4">
            {formError ? <Alert tone="destructive">{formError}</Alert> : null}
            <fieldset disabled={locked} className="contents">
              <FormGrid columns={2}>
                <FormField label="Name" error={errors.name?.message} required>
                  <Input autoFocus {...form.register('name')} />
                </FormField>
                <FormField
                  label="Key"
                  error={errors.key?.message}
                  description="Stable identifier, e.g. payroll_viewer."
                  required
                >
                  <Input {...form.register('key')} disabled={locked || Boolean(role)} />
                </FormField>
              </FormGrid>
              <FormField label="Description" error={errors.description?.message}>
                <Input {...form.register('description')} />
              </FormField>
            </fieldset>
            <Controller
              control={form.control}
              name="permissions"
              render={({ field }) => (
                <PermissionMatrix
                  catalog={catalog}
                  value={field.value}
                  onChange={field.onChange}
                  disabled={locked}
                />
              )}
            />
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {locked ? 'Close' : 'Cancel'}
            </Button>
            {locked ? null : (
              <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>
                {role ? 'Save role' : 'Create role'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const getRowId = (r: RoleDetails) => r.id;

export function RolesPage() {
  const queryClient = useQueryClient();
  const canManage = usePermission(PERMISSIONS.ROLES_ROLE_MANAGE);
  const roles = useRoles();
  const catalog = usePermissionCatalog();
  const [editing, setEditing] = useState<RoleDetails | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const openEditor = (role: RoleDetails | null) => {
    setEditing(role);
    setEditorKey((k) => k + 1);
    setEditorOpen(true);
  };
  const [deleting, setDeleting] = useState<RoleDetails | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/roles/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['roles'] });
      setDeleting(null);
    },
    onError: (err) => {
      setDeleteError(errorMessage(err));
    },
  });

  const columns = useMemo<DataTableColumnDef<RoleDetails>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Role',
        size: 240,
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate font-medium">
              {row.original.isSystem ? (
                <Lock className="size-3.5 text-muted-foreground" aria-label="System role" />
              ) : null}
              {row.original.name}
            </p>
            {row.original.description ? (
              <p className="truncate text-sm text-muted-foreground">{row.original.description}</p>
            ) : null}
          </div>
        ),
      },
      {
        id: 'permissions',
        header: 'Permissions',
        size: 120,
        meta: { align: 'right', numeric: true },
        accessorFn: (r) => r.permissions.length,
      },
      {
        accessorKey: 'memberCount',
        header: 'Members',
        size: 100,
        meta: { align: 'right', numeric: true },
      },
      {
        id: 'type',
        header: 'Type',
        size: 100,
        accessorFn: (r) => (r.isSystem ? 'System' : 'Custom'),
        cell: ({ row }) => (
          <Badge variant={row.original.isSystem ? 'neutral' : 'primary'}>
            {row.original.isSystem ? 'System' : 'Custom'}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: '',
        size: 150,
        enableSorting: false,
        enableHiding: false,
        enableResizing: false,
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                openEditor(row.original);
              }}
            >
              {canManage && !row.original.isSystem ? 'Edit' : 'View'}
            </Button>
            {canManage && !row.original.isSystem ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => {
                  setDeleteError(null);
                  setDeleting(row.original);
                }}
              >
                Delete
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [canManage],
  );

  return (
    <Page>
      <PageHeader
        title="Roles & permissions"
        description="Roles bundle permissions. Members get every permission of every role they hold."
        actions={
          canManage ? (
            <Button
              onClick={() => {
                openEditor(null);
              }}
            >
              <Plus /> New role
            </Button>
          ) : null
        }
      />
      <DataTable
        aria-label="Roles"
        columns={columns}
        data={roles.data ?? []}
        getRowId={getRowId}
        isLoading={roles.isPending}
        error={roles.isError ? errorMessage(roles.error) : null}
        onRetry={() => void roles.refetch()}
        hidePagination
        enableColumnVisibility={false}
      />
      <RoleEditor
        key={editorKey}
        role={editing}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        catalog={catalog.data ?? []}
        readOnly={!canManage}
      />
      {deleting ? (
        <ConfirmDialog
          open
          title={`Delete “${deleting.name}”?`}
          description="Roles that are still assigned to members cannot be deleted."
          confirmLabel="Delete role"
          destructive
          pending={remove.isPending}
          error={deleteError}
          onConfirm={() => {
            remove.mutate(deleting.id);
          }}
          onOpenChange={(o) => {
            if (!o) setDeleting(null);
          }}
        />
      ) : null}
    </Page>
  );
}

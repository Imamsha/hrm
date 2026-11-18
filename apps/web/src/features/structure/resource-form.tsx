import {
  Alert,
  Button,
  Checkbox,
  DialogBody,
  DialogFooter,
  FormField,
  FormGrid,
  Input,
  Select,
  type SelectOption,
  Textarea,
} from '@hrm/ui-web';
import { type QueryKey, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';
import { applyServerErrors } from '@/lib/forms';
import { type QueryParams, useRefOptions } from './api';
import { type FieldDef, type FormValues, toPayload } from './entity-payload';

function RefSelect({
  field,
  value,
  onChange,
  values,
  disabled,
  ...aria
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  values: FormValues;
  disabled?: boolean;
  /** Wiring injected by FormField (label association, error description). */
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
}) {
  const filterValue = field.refFilter ? values[field.refFilter.field] : undefined;
  const params: QueryParams = {
    ...(field.refParams ?? {}),
    ...(field.refFilter && filterValue ? { [field.refFilter.param]: filterValue } : {}),
  };
  const waiting = Boolean(field.refFilter && !filterValue);
  const options = useRefOptions(field.ref, params, !waiting);
  const list = options.data ?? [];
  return (
    <Select
      value={value}
      disabled={disabled || waiting || options.isPending}
      {...aria}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      placeholder={
        waiting
          ? 'Select the parent first'
          : options.isPending
            ? 'Loading…'
            : (field.placeholder ?? 'None')
      }
      options={field.required ? list : [{ value: '', label: '— None —' }, ...list]}
    />
  );
}

export interface ResourceFormProps {
  fields: FieldDef[];
  defaultValues: FormValues;
  /** Shared Zod schema the payload must satisfy before it is sent. */
  schema: z.ZodType;
  submit: (body: Record<string, unknown>) => Promise<unknown>;
  /** Query keys refreshed after a successful save. */
  invalidate: QueryKey[];
  submitLabel: string;
  onDone: () => void;
  /** Edit mode: create-only fields are locked and not sent. */
  editing?: boolean;
  /** Adds a status select (edit mode of archivable records). */
  statusOptions?: SelectOption[];
  /** Extra fixed values merged into the body (e.g. a change type chosen elsewhere). */
  extra?: Record<string, unknown>;
}

/**
 * Field-definition driven form: validates with the shared schema before any request, maps
 * server field errors back onto inputs, then invalidates the given queries.
 */
export function ResourceForm({
  fields,
  defaultValues,
  schema,
  submit,
  invalidate,
  submitLabel,
  onDone,
  editing = false,
  statusOptions,
  extra,
}: ResourceFormProps) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormValues>({ defaultValues });
  const values = useWatch({ control: form.control }) as FormValues;
  const fieldNames = fields.map((f) => f.name);

  const save = useMutation({
    mutationFn: submit,
    onSuccess: async () => {
      await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      onDone();
    },
    onError: (err) => {
      setFormError(applyServerErrors(err, form.setError, [...fieldNames, 'status']));
    },
  });

  const onSubmit = form.handleSubmit((raw) => {
    setFormError(null);
    const body = { ...toPayload(fields, raw, editing), ...(extra ?? {}) };
    if (!statusOptions) delete body.status;
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      let unmapped: string | null = null;
      for (const issue of parsed.error.issues) {
        const name = String(issue.path[0] ?? '');
        if (fieldNames.includes(name))
          form.setError(name, { type: 'validate', message: issue.message });
        else unmapped ??= issue.message;
      }
      setFormError(unmapped);
      return;
    }
    // Send what the user entered; the API applies the same schema (and its normalisation).
    save.mutate(body);
  });

  const { errors } = form.formState;
  const errorOf = (name: string) => {
    const e = errors[name];
    return typeof e?.message === 'string' ? e.message : undefined;
  };
  const visible = fields.filter((f) => (f.show ? f.show(values) : true));

  return (
    <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => void onSubmit(e)}>
      <DialogBody className="flex flex-col gap-4">
        {formError ? <Alert tone="destructive">{formError}</Alert> : null}
        <FormGrid columns={2}>
          {visible.map((f, i) => {
            const locked = editing && f.createOnly;
            const error = errorOf(f.name);
            const heading =
              f.section && f.section !== visible[i - 1]?.section ? (
                <h3
                  key={`section-${f.section}`}
                  className="border-b border-border pt-1 pb-1 text-sm font-semibold text-muted-foreground uppercase sm:col-span-2"
                >
                  {f.section}
                </h3>
              ) : null;
            if (f.kind === 'checkbox') {
              return [
                heading,
                <label key={f.name} className="flex items-center gap-2 self-end pb-2">
                  <Checkbox
                    checked={values[f.name] === 'true'}
                    onCheckedChange={(v) => {
                      form.setValue(f.name, v === true ? 'true' : 'false', { shouldDirty: true });
                    }}
                  />
                  {f.label}
                </label>,
              ];
            }
            return [
              heading,
              <FormField
                key={f.name}
                label={f.label}
                error={error}
                description={f.description}
                required={f.required ?? false}
                className={f.wide || f.kind === 'textarea' ? 'sm:col-span-2' : undefined}
              >
                {f.kind === 'ref' ? (
                  <RefSelect
                    field={f}
                    value={values[f.name] ?? ''}
                    onChange={(v) => {
                      form.setValue(f.name, v, { shouldDirty: true });
                      form.clearErrors(f.name);
                      // A dependent reference becomes invalid when its parent changes.
                      for (const dep of fields) {
                        if (dep.refFilter?.field === f.name) form.setValue(dep.name, '');
                      }
                    }}
                    values={values}
                    disabled={locked ?? false}
                  />
                ) : f.kind === 'select' ? (
                  <Select
                    {...form.register(f.name)}
                    value={values[f.name] ?? ''}
                    options={
                      f.required
                        ? (f.options ?? [])
                        : [{ value: '', label: '— None —' }, ...(f.options ?? [])]
                    }
                    placeholder={f.placeholder}
                    disabled={locked ?? false}
                  />
                ) : f.kind === 'textarea' ? (
                  <Textarea {...form.register(f.name)} placeholder={f.placeholder} />
                ) : (
                  <Input
                    {...form.register(f.name)}
                    type={f.kind === 'date' ? 'date' : f.kind === 'email' ? 'email' : 'text'}
                    inputMode={f.kind === 'number' ? 'numeric' : undefined}
                    placeholder={f.placeholder}
                    disabled={locked ?? false}
                  />
                )}
              </FormField>,
            ];
          })}
          {statusOptions ? (
            <FormField label="Status" error={errorOf('status')}>
              <Select
                {...form.register('status')}
                value={values.status ?? ''}
                options={statusOptions}
              />
            </FormField>
          ) : null}
        </FormGrid>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending} aria-busy={save.isPending}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

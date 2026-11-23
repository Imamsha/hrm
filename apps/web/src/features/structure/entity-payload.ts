import type { SelectOption } from '@hrm/ui-web';
import type { RefSource } from './api';

export type FormValues = Record<string, string>;

export interface FieldDef {
  name: string;
  label: string;
  kind?:
    | 'text'
    | 'textarea'
    | 'number'
    | 'select'
    | 'ref'
    | 'date'
    | 'time'
    | 'datetime'
    | 'email'
    | 'checkbox';
  options?: SelectOption[];
  ref?: RefSource;
  /** Filters `ref` options by another field's current value, e.g. legal entities by company. */
  refFilter?: { field: string; param: string };
  /** Fixed query parameters for `ref` options (e.g. only active employees). */
  refParams?: Record<string, string>;
  /** Value sent when left empty (default: null for optional fields). */
  blank?: string;
  /** Leave the field out of the body when empty ("keep the current value"). */
  omitIfBlank?: boolean;
  /** Starts a titled group of fields. */
  section?: string;
  required?: boolean;
  /** Set on create only; shown read-only when editing (e.g. the owning company). */
  createOnly?: boolean;
  description?: string;
  placeholder?: string;
  wide?: boolean;
  /** Hidden fields are submitted as null so stale values are cleared. */
  show?: (values: FormValues) => boolean;
}

/** Builds the request body: blank optional fields become null (= clear), hidden fields null. */
export function toPayload(
  fields: FieldDef[],
  values: FormValues,
  editing: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    if (editing && f.createOnly) continue;
    const visible = f.show ? f.show(values) : true;
    const raw = (values[f.name] ?? '').trim();
    if (f.omitIfBlank && raw === '') continue;
    if (f.kind === 'checkbox') body[f.name] = raw === 'true';
    else if (!visible) body[f.name] = null;
    else if (raw === '') body[f.name] = f.blank ?? (f.required ? '' : null);
    else body[f.name] = raw;
  }
  if (editing && values.status) body.status = values.status;
  return body;
}

import type {
  EmployeeDocumentCategoryValue,
  EmployeeStatusValue,
  EmploymentChangeTypeValue,
  EmploymentTypeValue,
  SeparationTypeValue,
} from '@hrm/shared-types';
import type { SelectOption } from '@hrm/ui-web';

export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentTypeValue, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  INTERN: 'Intern',
  CONSULTANT: 'Consultant',
};

export const STATUS_LABEL: Record<EmployeeStatusValue, string> = {
  ACTIVE: 'Active',
  ON_NOTICE: 'On notice',
  SEPARATED: 'Separated',
};

export const CHANGE_TYPE_LABEL: Record<EmploymentChangeTypeValue, string> = {
  JOINING: 'Joining',
  TRANSFER: 'Transfer',
  PROMOTION: 'Promotion',
  REDESIGNATION: 'Redesignation',
  MANAGER_CHANGE: 'Manager change',
  EMPLOYMENT_TYPE_CHANGE: 'Employment type change',
  REORGANIZATION: 'Reorganization',
  REJOINING: 'Rejoining',
};

export const SEPARATION_LABEL: Record<SeparationTypeValue, string> = {
  RESIGNATION: 'Resignation',
  TERMINATION: 'Termination',
  RETIREMENT: 'Retirement',
  CONTRACT_END: 'End of contract',
  OTHER: 'Other',
};

export const DOCUMENT_CATEGORY_LABEL: Record<EmployeeDocumentCategoryValue, string> = {
  IDENTITY: 'Identity proof',
  ADDRESS_PROOF: 'Address proof',
  EDUCATION: 'Education',
  EMPLOYMENT: 'Previous employment',
  CONTRACT: 'Contract',
  LETTER: 'Letter',
  OTHER: 'Other',
};

export const options = <K extends string>(labels: Record<K, string>): SelectOption[] =>
  (Object.entries(labels) as [K, string][]).map(([value, label]) => ({ value, label }));

export const GENDER_OPTIONS: SelectOption[] = [
  { value: 'FEMALE', label: 'Female' },
  { value: 'MALE', label: 'Male' },
  { value: 'NON_BINARY', label: 'Non-binary' },
  { value: 'OTHER', label: 'Other' },
  { value: 'UNDISCLOSED', label: 'Prefer not to say' },
];

export const MARITAL_OPTIONS: SelectOption[] = [
  { value: 'SINGLE', label: 'Single' },
  { value: 'MARRIED', label: 'Married' },
  { value: 'DIVORCED', label: 'Divorced' },
  { value: 'WIDOWED', label: 'Widowed' },
  { value: 'SEPARATED', label: 'Separated' },
  { value: 'UNDISCLOSED', label: 'Prefer not to say' },
];

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function todayIso(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

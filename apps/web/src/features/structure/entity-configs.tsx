import {
  type BranchItem,
  type CompanyItem,
  type CostCenterItem,
  type DepartmentItem,
  type DesignationItem,
  type JobGradeItem,
  type LegalEntityItem,
  type LocationItem,
  PERMISSIONS,
  type Ref,
  type TeamItem,
} from '@hrm/shared-types';
import type { DataTableColumnDef } from '@hrm/ui-web';
import {
  createBranchSchema,
  createCompanySchema,
  createCostCenterSchema,
  createDepartmentSchema,
  createDesignationSchema,
  createJobGradeSchema,
  createLegalEntitySchema,
  createLocationSchema,
  createTeamSchema,
  updateBranchSchema,
  updateCompanySchema,
  updateCostCenterSchema,
  updateDepartmentSchema,
  updateDesignationSchema,
  updateJobGradeSchema,
  updateLegalEntitySchema,
  updateLocationSchema,
  updateTeamSchema,
} from '@hrm/validation';
import type { RefSource } from './api';
import type { EntityConfig, FieldDef, FormValues } from './entity-manager';

const structureManage = PERMISSIONS.ORGANIZATION_STRUCTURE_MANAGE;

const COMPANIES: RefSource = { path: '/companies' };
const LOCATIONS: RefSource = { path: '/locations' };
const DEPARTMENTS: RefSource = { path: '/departments' };
const LEGAL_ENTITIES: RefSource = { path: '/legal-entities' };
const COST_CENTERS: RefSource = { path: '/cost-centers', sortBy: 'code' };
const JOB_GRADES: RefSource = {
  path: '/job-grades',
  sortBy: 'rank',
  label: (r) => `${String(r.rank)} · ${r.name} (${r.code ?? ''})`,
};
const WORK_WEEKS: RefSource = { path: '/work-weeks', paged: false };
const HOLIDAY_CALENDARS: RefSource = { path: '/holiday-calendars', paged: false };

const refText = (r: Ref | null) =>
  r ? (
    <span className="truncate">
      {r.name} <span className="text-muted-foreground">({r.code})</span>
    </span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
const dash = (v: string | null | undefined) => v ?? '';

const codeField: FieldDef = {
  name: 'code',
  label: 'Code',
  required: true,
  placeholder: 'e.g. BLR-01',
  description: 'Short unique code; letters, digits, “-” and “_”.',
};
const nameField = (label = 'Name'): FieldDef => ({ name: 'name', label, required: true });
const countryField: FieldDef = {
  name: 'countryCode',
  label: 'Country',
  required: true,
  placeholder: 'IN',
  description: 'ISO 3166 two-letter code.',
};
const timezoneField: FieldDef = {
  name: 'timezone',
  label: 'Time zone',
  placeholder: 'Asia/Kolkata',
};
const codeCol = <T extends { code: string }>(): DataTableColumnDef<T> => ({
  id: 'code',
  accessorKey: 'code',
  header: 'Code',
  size: 120,
  cell: ({ row }) => <span className="font-mono text-sm">{row.original.code}</span>,
});
const nameCol = <T extends { name: string }>(): DataTableColumnDef<T> => ({
  id: 'name',
  accessorKey: 'name',
  header: 'Name',
  size: 240,
});
const isIndia = (v: FormValues) => (v.countryCode ?? '').trim().toUpperCase() === 'IN';

export const companyConfig: EntityConfig<CompanyItem> = {
  path: '/companies',
  singular: 'company',
  plural: 'Companies',
  manage: structureManage,
  defaultSort: 'name',
  columns: [
    codeCol(),
    nameCol(),
    {
      id: 'country',
      header: 'Country',
      size: 90,
      enableSorting: false,
      accessorKey: 'countryCode',
    },
    {
      id: 'counts',
      header: 'Entities · branches · departments',
      size: 220,
      enableSorting: false,
      cell: ({ row }) => {
        const c = row.original.counts;
        return `${String(c.legalEntities)} · ${String(c.branches)} · ${String(c.departments)}`;
      },
    },
  ],
  fields: [
    codeField,
    nameField(),
    countryField,
    { name: 'defaultCurrency', label: 'Default currency', placeholder: 'INR' },
    timezoneField,
  ],
  createSchema: createCompanySchema,
  updateSchema: updateCompanySchema,
  emptyValues: {
    code: '',
    name: '',
    countryCode: 'IN',
    defaultCurrency: 'INR',
    timezone: 'Asia/Kolkata',
  },
  toValues: (c) => ({
    code: c.code,
    name: c.name,
    countryCode: c.countryCode,
    defaultCurrency: dash(c.defaultCurrency),
    timezone: dash(c.timezone),
    status: c.status,
  }),
  title: (c) => `${c.name} (${c.code})`,
};

export const legalEntityConfig: EntityConfig<LegalEntityItem> = {
  path: '/legal-entities',
  singular: 'legal entity',
  plural: 'Legal entities',
  manage: structureManage,
  defaultSort: 'name',
  filters: [{ param: 'companyId', label: 'Companies', ref: COMPANIES }],
  columns: [
    codeCol(),
    { id: 'name', accessorKey: 'legalName', header: 'Legal name', size: 260 },
    {
      id: 'company',
      header: 'Company',
      size: 180,
      enableSorting: false,
      cell: ({ row }) => refText(row.original.company),
    },
    {
      id: 'identifiers',
      header: 'PAN · GSTIN',
      size: 260,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-mono text-sm">
          {[row.original.pan, row.original.gstin].filter(Boolean).join(' · ') || '—'}
        </span>
      ),
    },
  ],
  fields: [
    {
      name: 'companyId',
      label: 'Company',
      kind: 'ref',
      ref: COMPANIES,
      required: true,
      createOnly: true,
    },
    codeField,
    { name: 'legalName', label: 'Registered legal name', required: true, wide: true },
    countryField,
    { name: 'registrationNumber', label: 'Registration number' },
    { name: 'pan', label: 'PAN', placeholder: 'AAAAA9999A', show: isIndia },
    { name: 'tan', label: 'TAN', placeholder: 'AAAA99999A', show: isIndia },
    {
      name: 'gstin',
      label: 'GSTIN',
      placeholder: '29AAAAA9999A1Z5',
      show: isIndia,
      description: 'Must contain the PAN.',
    },
    { name: 'cin', label: 'CIN', placeholder: 'U72200KA2020PTC123456', show: isIndia },
    {
      name: 'registeredLocationId',
      label: 'Registered office',
      kind: 'ref',
      ref: LOCATIONS,
      wide: true,
    },
  ],
  createSchema: createLegalEntitySchema,
  updateSchema: updateLegalEntitySchema,
  emptyValues: {
    companyId: '',
    code: '',
    legalName: '',
    countryCode: 'IN',
    registrationNumber: '',
    pan: '',
    tan: '',
    gstin: '',
    cin: '',
    registeredLocationId: '',
  },
  toValues: (e) => ({
    companyId: e.company.id,
    code: e.code,
    legalName: e.legalName,
    countryCode: e.countryCode,
    registrationNumber: dash(e.registrationNumber),
    pan: dash(e.pan),
    tan: dash(e.tan),
    gstin: dash(e.gstin),
    cin: dash(e.cin),
    registeredLocationId: e.registeredLocation?.id ?? '',
    status: e.status,
  }),
  title: (e) => `${e.legalName} (${e.code})`,
};

export const locationConfig: EntityConfig<LocationItem> = {
  path: '/locations',
  singular: 'location',
  plural: 'Locations',
  manage: structureManage,
  defaultSort: 'name',
  columns: [
    codeCol(),
    nameCol(),
    {
      id: 'city',
      accessorKey: 'city',
      header: 'City',
      size: 160,
      cell: ({ row }) => [row.original.city, row.original.state].filter(Boolean).join(', '),
    },
    {
      id: 'country',
      header: 'Country',
      size: 90,
      enableSorting: false,
      accessorKey: 'countryCode',
    },
  ],
  fields: [
    codeField,
    nameField(),
    { name: 'addressLine1', label: 'Address line 1', required: true, wide: true },
    { name: 'addressLine2', label: 'Address line 2', wide: true },
    { name: 'city', label: 'City', required: true },
    { name: 'state', label: 'State / province' },
    { name: 'postalCode', label: 'Postal code' },
    countryField,
    timezoneField,
    {
      name: 'latitude',
      label: 'Latitude',
      placeholder: '12.971599',
      description: 'Optional, decimal degrees.',
    },
    { name: 'longitude', label: 'Longitude', placeholder: '77.594566' },
  ],
  createSchema: createLocationSchema,
  updateSchema: updateLocationSchema,
  emptyValues: {
    code: '',
    name: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    countryCode: 'IN',
    timezone: 'Asia/Kolkata',
    latitude: '',
    longitude: '',
  },
  toValues: (l) => ({
    code: l.code,
    name: l.name,
    addressLine1: l.addressLine1,
    addressLine2: dash(l.addressLine2),
    city: l.city,
    state: dash(l.state),
    postalCode: dash(l.postalCode),
    countryCode: l.countryCode,
    timezone: dash(l.timezone),
    latitude: dash(l.latitude),
    longitude: dash(l.longitude),
    status: l.status,
  }),
  title: (l) => `${l.name} (${l.code})`,
};

export const branchConfig: EntityConfig<BranchItem> = {
  path: '/branches',
  singular: 'branch',
  plural: 'Branches',
  manage: structureManage,
  defaultSort: 'name',
  filters: [{ param: 'companyId', label: 'Companies', ref: COMPANIES }],
  columns: [
    codeCol(),
    nameCol(),
    {
      id: 'company',
      header: 'Company',
      size: 180,
      cell: ({ row }) => refText(row.original.company),
    },
    {
      id: 'location',
      header: 'Location',
      size: 180,
      enableSorting: false,
      cell: ({ row }) => refText(row.original.location),
    },
    {
      id: 'calendar',
      header: 'Work week · holidays',
      size: 220,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.workWeek?.name ?? 'Org default'} ·{' '}
          {row.original.holidayCalendar?.name ?? 'Org default'}
        </span>
      ),
    },
  ],
  fields: [
    {
      name: 'companyId',
      label: 'Company',
      kind: 'ref',
      ref: COMPANIES,
      required: true,
      createOnly: true,
    },
    codeField,
    nameField(),
    {
      name: 'legalEntityId',
      label: 'Legal entity',
      kind: 'ref',
      ref: LEGAL_ENTITIES,
      refFilter: { field: 'companyId', param: 'companyId' },
    },
    { name: 'locationId', label: 'Location', kind: 'ref', ref: LOCATIONS },
    timezoneField,
    {
      name: 'workWeekId',
      label: 'Work week',
      kind: 'ref',
      ref: WORK_WEEKS,
      placeholder: 'Organization default',
      description: 'Empty = organization default.',
    },
    {
      name: 'holidayCalendarId',
      label: 'Holiday calendar',
      kind: 'ref',
      ref: HOLIDAY_CALENDARS,
      placeholder: 'Organization default',
      description: 'Empty = organization default.',
    },
  ],
  createSchema: createBranchSchema,
  updateSchema: updateBranchSchema,
  emptyValues: {
    companyId: '',
    code: '',
    name: '',
    legalEntityId: '',
    locationId: '',
    timezone: '',
    workWeekId: '',
    holidayCalendarId: '',
  },
  toValues: (b) => ({
    companyId: b.company.id,
    code: b.code,
    name: b.name,
    legalEntityId: b.legalEntity?.id ?? '',
    locationId: b.location?.id ?? '',
    timezone: dash(b.timezone),
    workWeekId: b.workWeek?.id ?? '',
    holidayCalendarId: b.holidayCalendar?.id ?? '',
    status: b.status,
  }),
  title: (b) => `${b.name} (${b.code})`,
};

export const costCenterConfig: EntityConfig<CostCenterItem> = {
  path: '/cost-centers',
  singular: 'cost center',
  plural: 'Cost centers',
  manage: structureManage,
  defaultSort: 'code',
  filters: [{ param: 'companyId', label: 'Companies', ref: COMPANIES }],
  columns: [
    codeCol(),
    nameCol(),
    {
      id: 'company',
      header: 'Company',
      size: 200,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.company ? (
          refText(row.original.company)
        ) : (
          <span className="text-muted-foreground">All companies</span>
        ),
    },
  ],
  fields: [
    codeField,
    nameField(),
    {
      name: 'companyId',
      label: 'Company',
      kind: 'ref',
      ref: COMPANIES,
      description: 'Leave empty for an organization-wide cost center.',
      wide: true,
    },
  ],
  createSchema: createCostCenterSchema,
  updateSchema: updateCostCenterSchema,
  emptyValues: { code: '', name: '', companyId: '' },
  toValues: (c) => ({
    code: c.code,
    name: c.name,
    companyId: c.company?.id ?? '',
    status: c.status,
  }),
  title: (c) => `${c.name} (${c.code})`,
};

export const departmentConfig: EntityConfig<DepartmentItem> = {
  path: '/departments',
  singular: 'department',
  plural: 'Departments',
  manage: structureManage,
  defaultSort: 'name',
  filters: [{ param: 'companyId', label: 'Companies', ref: COMPANIES }],
  columns: [
    codeCol(),
    nameCol(),
    {
      id: 'company',
      header: 'Company',
      size: 170,
      cell: ({ row }) => refText(row.original.company),
    },
    {
      id: 'parent',
      header: 'Parent',
      size: 170,
      enableSorting: false,
      cell: ({ row }) => refText(row.original.parent),
    },
    {
      id: 'counts',
      header: 'Sub-depts · teams',
      size: 130,
      enableSorting: false,
      cell: ({ row }) =>
        `${String(row.original.counts.children)} · ${String(row.original.counts.teams)}`,
    },
  ],
  fields: [
    {
      name: 'companyId',
      label: 'Company',
      kind: 'ref',
      ref: COMPANIES,
      required: true,
      createOnly: true,
    },
    codeField,
    nameField(),
    {
      name: 'parentId',
      label: 'Parent department',
      kind: 'ref',
      ref: DEPARTMENTS,
      refFilter: { field: 'companyId', param: 'companyId' },
      description: 'Empty = top-level department.',
    },
    { name: 'costCenterId', label: 'Cost center', kind: 'ref', ref: COST_CENTERS },
  ],
  createSchema: createDepartmentSchema,
  updateSchema: updateDepartmentSchema,
  emptyValues: { companyId: '', code: '', name: '', parentId: '', costCenterId: '' },
  toValues: (d) => ({
    companyId: d.company.id,
    code: d.code,
    name: d.name,
    parentId: d.parent?.id ?? '',
    costCenterId: d.costCenter?.id ?? '',
    status: d.status,
  }),
  title: (d) => `${d.name} (${d.code})`,
};

export const teamConfig: EntityConfig<TeamItem> = {
  path: '/teams',
  singular: 'team',
  plural: 'Teams',
  manage: structureManage,
  defaultSort: 'name',
  filters: [{ param: 'departmentId', label: 'Departments', ref: DEPARTMENTS }],
  columns: [
    codeCol(),
    nameCol(),
    {
      id: 'department',
      header: 'Department',
      size: 220,
      cell: ({ row }) => refText(row.original.department),
    },
  ],
  fields: [
    codeField,
    nameField(),
    {
      name: 'departmentId',
      label: 'Department',
      kind: 'ref',
      ref: DEPARTMENTS,
      required: true,
      wide: true,
    },
  ],
  createSchema: createTeamSchema,
  updateSchema: updateTeamSchema,
  emptyValues: { code: '', name: '', departmentId: '' },
  toValues: (t) => ({
    code: t.code,
    name: t.name,
    departmentId: t.department.id,
    status: t.status,
  }),
  title: (t) => `${t.name} (${t.code})`,
};

const catalogManage = PERMISSIONS.ORGANIZATION_JOB_CATALOG_MANAGE;

export const jobGradeConfig: EntityConfig<JobGradeItem> = {
  path: '/job-grades',
  singular: 'job grade',
  plural: 'Job grades',
  manage: catalogManage,
  defaultSort: 'rank',
  columns: [
    {
      id: 'rank',
      accessorKey: 'rank',
      header: 'Rank',
      size: 80,
      meta: { numeric: true },
    },
    codeCol(),
    nameCol(),
    {
      id: 'designations',
      header: 'Designations',
      size: 120,
      enableSorting: false,
      meta: { numeric: true },
      accessorKey: 'designationCount',
    },
  ],
  fields: [
    codeField,
    nameField(),
    {
      name: 'rank',
      label: 'Rank',
      kind: 'number',
      required: true,
      description: 'Unique ordering, 1 = most junior.',
    },
    { name: 'description', label: 'Description', kind: 'textarea' },
  ],
  createSchema: createJobGradeSchema,
  updateSchema: updateJobGradeSchema,
  emptyValues: { code: '', name: '', rank: '', description: '' },
  toValues: (g) => ({
    code: g.code,
    name: g.name,
    rank: String(g.rank),
    description: dash(g.description),
    status: g.status,
  }),
  title: (g) => `${g.name} (${g.code})`,
};

export const designationConfig: EntityConfig<DesignationItem> = {
  path: '/designations',
  singular: 'designation',
  plural: 'Designations',
  manage: catalogManage,
  defaultSort: 'name',
  filters: [{ param: 'jobGradeId', label: 'Grades', ref: JOB_GRADES }],
  columns: [
    codeCol(),
    nameCol(),
    {
      id: 'grade',
      header: 'Job grade',
      size: 200,
      cell: ({ row }) => {
        const g = row.original.jobGrade;
        return g ? (
          `${String(g.rank)} · ${g.name}`
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
  ],
  fields: [
    codeField,
    nameField('Title'),
    { name: 'jobGradeId', label: 'Job grade', kind: 'ref', ref: JOB_GRADES },
    { name: 'description', label: 'Description', kind: 'textarea' },
  ],
  createSchema: createDesignationSchema,
  updateSchema: updateDesignationSchema,
  emptyValues: { code: '', name: '', jobGradeId: '', description: '' },
  toValues: (d) => ({
    code: d.code,
    name: d.name,
    jobGradeId: d.jobGrade?.id ?? '',
    description: dash(d.description),
    status: d.status,
  }),
  title: (d) => `${d.name} (${d.code})`,
};

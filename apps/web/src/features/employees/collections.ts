import type {
  CertificationItem,
  EducationItem,
  EmergencyContactItem,
  EmployeeAddressItem,
  EmployeeCollection,
  ExperienceItem,
  FamilyMemberItem,
  SkillItem,
} from '@hrm/shared-types';
import {
  addressSchema,
  certificationSchema,
  educationSchema,
  emergencyContactSchema,
  experienceSchema,
  familyMemberSchema,
  skillSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import type { FieldDef, FormValues } from '@/features/structure/entity-payload';
import { formatDate, GENDER_OPTIONS } from './labels';

export interface Summary {
  primary: string;
  secondary?: string | undefined;
  badge?: string | undefined;
}

export interface CollectionDef {
  key: EmployeeCollection;
  title: string;
  singular: string;
  fields: FieldDef[];
  schema: z.ZodType;
  empty: FormValues;
  toValues: (item: never) => FormValues;
  summary: (item: never) => Summary;
}

const s = (v: string | number | null | undefined) =>
  v === null || v === undefined ? '' : String(v);
const empty = (fields: FieldDef[]): FormValues =>
  Object.fromEntries(fields.map((f) => [f.name, f.kind === 'checkbox' ? 'false' : '']));
const def = <T>(
  d: Omit<CollectionDef, 'toValues' | 'summary' | 'empty'> & {
    toValues: (item: T) => FormValues;
    summary: (item: T) => Summary;
    empty?: FormValues;
  },
): CollectionDef => ({ ...d, empty: d.empty ?? empty(d.fields) });

export const addresses = def<EmployeeAddressItem>({
  key: 'addresses',
  title: 'Addresses',
  singular: 'address',
  schema: addressSchema,
  fields: [
    {
      name: 'type',
      label: 'Type',
      kind: 'select',
      required: true,
      placeholder: 'Select…',
      options: [
        { value: 'CURRENT', label: 'Current' },
        { value: 'PERMANENT', label: 'Permanent' },
      ],
    },
    { name: 'countryCode', label: 'Country', required: true, placeholder: 'IN' },
    { name: 'line1', label: 'Address line 1', required: true, wide: true },
    { name: 'line2', label: 'Address line 2', wide: true },
    { name: 'city', label: 'City', required: true },
    { name: 'state', label: 'State' },
    { name: 'postalCode', label: 'PIN / postal code' },
  ],
  empty: { type: '', countryCode: 'IN', line1: '', line2: '', city: '', state: '', postalCode: '' },
  toValues: (a) => ({
    type: a.type,
    countryCode: a.countryCode,
    line1: a.line1,
    line2: s(a.line2),
    city: a.city,
    state: s(a.state),
    postalCode: s(a.postalCode),
  }),
  summary: (a) => ({
    primary: [a.line1, a.line2].filter(Boolean).join(', '),
    secondary: [a.city, a.state, a.postalCode, a.countryCode].filter(Boolean).join(', '),
    badge: a.type === 'CURRENT' ? 'Current' : 'Permanent',
  }),
});

export const emergencyContacts = def<EmergencyContactItem>({
  key: 'emergency-contacts',
  title: 'Emergency contacts',
  singular: 'emergency contact',
  schema: emergencyContactSchema,
  fields: [
    { name: 'name', label: 'Name', required: true },
    { name: 'relationship', label: 'Relationship', required: true, placeholder: 'e.g. Spouse' },
    { name: 'phone', label: 'Phone', required: true },
    { name: 'email', label: 'E-mail', kind: 'email' },
    { name: 'isPrimary', label: 'Primary contact', kind: 'checkbox' },
  ],
  toValues: (c) => ({
    name: c.name,
    relationship: c.relationship,
    phone: c.phone,
    email: s(c.email),
    isPrimary: String(c.isPrimary),
  }),
  summary: (c) => ({
    primary: `${c.name} · ${c.relationship}`,
    secondary: [c.phone, c.email].filter(Boolean).join(' · '),
    badge: c.isPrimary ? 'Primary' : undefined,
  }),
});

const RELATIONS = [
  { value: 'SPOUSE', label: 'Spouse' },
  { value: 'CHILD', label: 'Child' },
  { value: 'FATHER', label: 'Father' },
  { value: 'MOTHER', label: 'Mother' },
  { value: 'SIBLING', label: 'Sibling' },
  { value: 'OTHER', label: 'Other' },
];

export const familyMembers = def<FamilyMemberItem>({
  key: 'family-members',
  title: 'Family',
  singular: 'family member',
  schema: familyMemberSchema,
  fields: [
    { name: 'name', label: 'Name', required: true },
    {
      name: 'relation',
      label: 'Relation',
      kind: 'select',
      required: true,
      placeholder: 'Select…',
      options: RELATIONS,
    },
    { name: 'dateOfBirth', label: 'Date of birth', kind: 'date' },
    { name: 'gender', label: 'Gender', kind: 'select', options: GENDER_OPTIONS },
    { name: 'phone', label: 'Phone' },
    { name: 'isDependent', label: 'Dependent', kind: 'checkbox' },
  ],
  toValues: (f) => ({
    name: f.name,
    relation: f.relation,
    dateOfBirth: s(f.dateOfBirth),
    gender: s(f.gender),
    phone: s(f.phone),
    isDependent: String(f.isDependent),
  }),
  summary: (f) => ({
    primary: `${f.name} · ${RELATIONS.find((r) => r.value === f.relation)?.label ?? f.relation}`,
    secondary: f.dateOfBirth ? `Born ${formatDate(f.dateOfBirth)}` : undefined,
    badge: f.isDependent ? 'Dependent' : undefined,
  }),
});

export const education = def<EducationItem>({
  key: 'education',
  title: 'Education',
  singular: 'education record',
  schema: educationSchema,
  fields: [
    { name: 'qualification', label: 'Qualification', required: true, placeholder: 'e.g. B.Tech' },
    { name: 'fieldOfStudy', label: 'Field of study' },
    { name: 'institution', label: 'Institution', required: true, wide: true },
    { name: 'startYear', label: 'Start year', kind: 'number' },
    { name: 'endYear', label: 'End year', kind: 'number' },
    { name: 'grade', label: 'Grade / score' },
  ],
  toValues: (e) => ({
    qualification: e.qualification,
    fieldOfStudy: s(e.fieldOfStudy),
    institution: e.institution,
    startYear: s(e.startYear),
    endYear: s(e.endYear),
    grade: s(e.grade),
  }),
  summary: (e) => ({
    primary: [e.qualification, e.fieldOfStudy].filter(Boolean).join(', '),
    secondary: [e.institution, [e.startYear, e.endYear].filter(Boolean).join('–'), e.grade]
      .filter(Boolean)
      .join(' · '),
  }),
});

export const experience = def<ExperienceItem>({
  key: 'experience',
  title: 'Previous experience',
  singular: 'experience record',
  schema: experienceSchema,
  fields: [
    { name: 'employer', label: 'Employer', required: true },
    { name: 'jobTitle', label: 'Job title', required: true },
    { name: 'startDate', label: 'From', kind: 'date', required: true },
    { name: 'endDate', label: 'To', kind: 'date', required: true },
    { name: 'location', label: 'Location', wide: true },
    { name: 'description', label: 'Description', kind: 'textarea' },
  ],
  toValues: (e) => ({
    employer: e.employer,
    jobTitle: e.jobTitle,
    startDate: e.startDate,
    endDate: e.endDate,
    location: s(e.location),
    description: s(e.description),
  }),
  summary: (e) => ({
    primary: `${e.jobTitle} · ${e.employer}`,
    secondary: `${formatDate(e.startDate)} – ${formatDate(e.endDate)}${e.location ? ` · ${e.location}` : ''}`,
  }),
});

export const certifications = def<CertificationItem>({
  key: 'certifications',
  title: 'Certifications',
  singular: 'certification',
  schema: certificationSchema,
  fields: [
    { name: 'name', label: 'Certification', required: true, wide: true },
    { name: 'issuer', label: 'Issuer' },
    { name: 'credentialId', label: 'Credential ID' },
    { name: 'issuedOn', label: 'Issued on', kind: 'date' },
    { name: 'expiresOn', label: 'Expires on', kind: 'date' },
  ],
  toValues: (c) => ({
    name: c.name,
    issuer: s(c.issuer),
    credentialId: s(c.credentialId),
    issuedOn: s(c.issuedOn),
    expiresOn: s(c.expiresOn),
  }),
  summary: (c) => ({
    primary: c.name,
    secondary: [
      c.issuer,
      c.issuedOn ? `issued ${formatDate(c.issuedOn)}` : null,
      c.expiresOn ? `expires ${formatDate(c.expiresOn)}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  }),
});

const LEVELS = [
  { value: 'BEGINNER', label: 'Beginner' },
  { value: 'INTERMEDIATE', label: 'Intermediate' },
  { value: 'ADVANCED', label: 'Advanced' },
  { value: 'EXPERT', label: 'Expert' },
];

export const skills = def<SkillItem>({
  key: 'skills',
  title: 'Skills',
  singular: 'skill',
  schema: skillSchema,
  fields: [
    { name: 'name', label: 'Skill', required: true },
    {
      name: 'level',
      label: 'Level',
      kind: 'select',
      required: true,
      placeholder: 'Select…',
      options: LEVELS,
    },
    { name: 'years', label: 'Years of experience', kind: 'number' },
  ],
  toValues: (k) => ({ name: k.name, level: k.level, years: s(k.years) }),
  summary: (k) => ({
    primary: k.name,
    secondary: k.years !== null ? `${String(k.years)} years` : undefined,
    badge: LEVELS.find((l) => l.value === k.level)?.label,
  }),
});

export const PERSONAL_COLLECTIONS = [addresses, emergencyContacts, familyMembers];
export const BACKGROUND_COLLECTIONS = [education, experience, certifications, skills];

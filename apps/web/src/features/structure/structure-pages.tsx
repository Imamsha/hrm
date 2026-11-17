import { Tabs, TabsContent, TabsList, TabsTrigger } from '@hrm/ui-web';
import { useSearchParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import {
  branchConfig,
  companyConfig,
  costCenterConfig,
  departmentConfig,
  designationConfig,
  jobGradeConfig,
  legalEntityConfig,
  locationConfig,
  teamConfig,
} from './entity-configs';
import { EntityManager } from './entity-manager';

interface TabDef {
  value: string;
  label: string;
  render: () => React.ReactNode;
}

/** Tabs whose selection lives in `?tab=` so links and reloads keep the current view. */
function UrlTabs({ tabs, label }: { tabs: TabDef[]; label: string }) {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const active = tabs.some((t) => t.value === requested)
    ? (requested ?? '')
    : (tabs[0]?.value ?? '');
  return (
    <Tabs
      value={active}
      onValueChange={(v) => {
        setParams({ tab: v }, { replace: true });
      }}
    >
      <TabsList aria-label={label}>
        {tabs.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          {/* Only the active tab mounts, so only its data is fetched. */}
          {t.value === active ? t.render() : null}
        </TabsContent>
      ))}
    </Tabs>
  );
}

const STRUCTURE_TABS: TabDef[] = [
  {
    value: 'companies',
    label: 'Companies',
    render: () => <EntityManager config={companyConfig} />,
  },
  {
    value: 'legal-entities',
    label: 'Legal entities',
    render: () => <EntityManager config={legalEntityConfig} />,
  },
  { value: 'branches', label: 'Branches', render: () => <EntityManager config={branchConfig} /> },
  {
    value: 'locations',
    label: 'Locations',
    render: () => <EntityManager config={locationConfig} />,
  },
  {
    value: 'departments',
    label: 'Departments',
    render: () => <EntityManager config={departmentConfig} />,
  },
  { value: 'teams', label: 'Teams', render: () => <EntityManager config={teamConfig} /> },
  {
    value: 'cost-centers',
    label: 'Cost centers',
    render: () => <EntityManager config={costCenterConfig} />,
  },
];

export function StructurePage() {
  return (
    <Page>
      <PageHeader
        title="Organization structure"
        description="Companies, legal entities, branches, locations, departments, teams and cost centers."
      />
      <UrlTabs tabs={STRUCTURE_TABS} label="Structure sections" />
    </Page>
  );
}

const CATALOG_TABS: TabDef[] = [
  {
    value: 'designations',
    label: 'Designations',
    render: () => <EntityManager config={designationConfig} />,
  },
  { value: 'grades', label: 'Job grades', render: () => <EntityManager config={jobGradeConfig} /> },
];

export function JobCatalogPage() {
  return (
    <Page>
      <PageHeader
        title="Job catalog"
        description="Designations (job titles) and the job grades that rank them."
      />
      <UrlTabs tabs={CATALOG_TABS} label="Job catalog sections" />
    </Page>
  );
}

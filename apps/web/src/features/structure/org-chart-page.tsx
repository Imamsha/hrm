import type { OrgChart, OrgChartDepartmentNode } from '@hrm/shared-types';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  ErrorState,
  Skeleton,
} from '@hrm/ui-web';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronDown, ChevronRight, MapPin, Network, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { api, errorMessage } from '@/lib/api';

function countDepartments(nodes: OrgChartDepartmentNode[]): number {
  return nodes.reduce((n, d) => n + 1 + countDepartments(d.children), 0);
}

function DepartmentNode({ node, level }: { node: OrgChartDepartmentNode; level: number }) {
  const [open, setOpen] = useState(level < 2);
  const hasChildren = node.children.length > 0 || node.teams.length > 0;
  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? open : undefined}
      aria-level={level + 1}
      aria-selected={false}
    >
      <div className="flex items-center gap-1.5 rounded-md px-1 py-1 hover:bg-accent">
        {hasChildren ? (
          <button
            type="button"
            className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
            aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={() => {
              setOpen((o) => !o);
            }}
          >
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : (
          <span className="size-5" />
        )}
        <Network className="size-4 text-muted-foreground" />
        <span className="font-medium">{node.name}</span>
        <span className="font-mono text-sm text-muted-foreground">{node.code}</span>
        {node.status === 'INACTIVE' ? <Badge variant="neutral">Inactive</Badge> : null}
      </div>
      {open && hasChildren ? (
        <ul role="group" className="ml-5 border-l border-border pl-3">
          {node.teams.map((t) => (
            <li
              key={t.id}
              role="treeitem"
              aria-level={level + 2}
              aria-selected={false}
              className="flex items-center gap-1.5 px-1 py-1"
            >
              <span className="size-5" />
              <Users className="size-4 text-muted-foreground" />
              <span>{t.name}</span>
              <span className="font-mono text-sm text-muted-foreground">{t.code}</span>
            </li>
          ))}
          {node.children.map((c) => (
            <DepartmentNode key={c.id} node={c} level={level + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Structure tree: companies → departments (nested) → teams, with each company's branches. */
export function OrgChartPage() {
  const [includeInactive, setIncludeInactive] = useState(false);
  const chart = useQuery({
    queryKey: ['structure', '/org-chart', includeInactive],
    queryFn: () => api.get<OrgChart>('/org-chart', { query: { includeInactive } }),
  });

  return (
    <Page>
      <PageHeader
        title="Org chart"
        description="How companies, departments and teams fit together. People are added with employee records."
        actions={
          <label className="flex items-center gap-2 text-base">
            <Checkbox
              checked={includeInactive}
              onCheckedChange={(v) => {
                setIncludeInactive(v === true);
              }}
            />
            Show inactive
          </label>
        }
      />
      {chart.isPending ? (
        <Skeleton className="h-64" />
      ) : chart.isError ? (
        <ErrorState
          title="Could not load the org chart"
          description={errorMessage(chart.error)}
          onRetry={() => void chart.refetch()}
        />
      ) : chart.data.companies.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="No companies yet"
          description="Create a company and its departments to see the org chart."
          action={
            <Link
              className="text-primary underline-offset-4 hover:underline"
              to="/organization/structure"
            >
              Go to organization structure
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {chart.data.companies.map((company) => (
            <Card key={company.id}>
              <CardHeader>
                <div className="flex min-w-0 items-center gap-2">
                  <Building2 className="size-4 text-muted-foreground" />
                  <CardTitle>{company.name}</CardTitle>
                  <span className="font-mono text-sm text-muted-foreground">{company.code}</span>
                  {company.status === 'INACTIVE' ? <Badge variant="neutral">Inactive</Badge> : null}
                </div>
                <span className="text-sm text-muted-foreground">
                  {countDepartments(company.departments)} departments · {company.branches.length}{' '}
                  branches
                </span>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {company.branches.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <MapPin className="size-4 text-muted-foreground" />
                    {company.branches.map((b) => (
                      <Badge key={b.id} variant="outline">
                        {b.name}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {company.departments.length > 0 ? (
                  <ul role="tree" aria-label={`${company.name} departments`}>
                    {company.departments.map((d) => (
                      <DepartmentNode key={d.id} node={d} level={0} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">No departments yet.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}

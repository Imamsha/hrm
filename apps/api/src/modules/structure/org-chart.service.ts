import { Injectable } from '@nestjs/common';
import type { OrgChart, OrgChartDepartmentNode } from '@hrm/shared-types';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

interface DeptRow {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  companyId: string;
  parentId: string | null;
  teams: { id: string; code: string; name: string }[];
}

/** Builds the department forest for one company from a flat list (O(n)). */
export function buildDepartmentTree(rows: DeptRow[]): OrgChartDepartmentNode[] {
  const byId = new Map<string, OrgChartDepartmentNode>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      code: r.code,
      name: r.name,
      status: r.status,
      teams: r.teams,
      children: [],
    });
  }
  const roots: OrgChartDepartmentNode[] = [];
  for (const r of rows) {
    const node = byId.get(r.id);
    if (!node) continue;
    const parent = r.parentId ? byId.get(r.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (nodes: OrgChartDepartmentNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => {
      sort(n.children);
    });
  };
  sort(roots);
  return roots;
}

/** Structure chart: companies → branches and department trees with teams. */
@Injectable()
export class OrgChartService {
  constructor(private readonly prisma: PrismaService) {}

  get(includeInactive: boolean): Promise<OrgChart> {
    const status = includeInactive ? {} : { status: 'ACTIVE' as const };
    return this.prisma.withTenant(async (tx) => {
      const [companies, branches, departments] = await Promise.all([
        tx.company.findMany({ where: status, orderBy: { name: 'asc' } }),
        tx.branch.findMany({
          where: status,
          orderBy: { name: 'asc' },
          select: { id: true, code: true, name: true, companyId: true },
        }),
        tx.department.findMany({
          where: status,
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            companyId: true,
            parentId: true,
            teams: {
              where: status,
              orderBy: { name: 'asc' },
              select: { id: true, code: true, name: true },
            },
          },
        }),
      ]);
      return {
        companies: companies.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          status: c.status,
          branches: branches
            .filter((b) => b.companyId === c.id)
            .map(({ id, code, name }) => ({ id, code, name })),
          departments: buildDepartmentTree(departments.filter((d) => d.companyId === c.id)),
        })),
      };
    });
  }
}

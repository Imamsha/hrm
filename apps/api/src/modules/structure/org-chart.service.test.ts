import { describe, expect, it } from 'vitest';
import { buildDepartmentTree } from './org-chart.service.js';

const row = (id: string, name: string, parentId: string | null) => ({
  id,
  code: id.toUpperCase(),
  name,
  status: 'ACTIVE' as const,
  companyId: 'c1',
  parentId,
  teams: [],
});

describe('buildDepartmentTree', () => {
  it('nests sub-departments under their parents and sorts by name', () => {
    const tree = buildDepartmentTree([
      row('ops', 'Operations', null),
      row('eng', 'Engineering', null),
      row('platform', 'Platform', 'eng'),
      row('apps', 'Applications', 'eng'),
      row('sre', 'SRE', 'platform'),
    ]);
    expect(tree.map((n) => n.name)).toEqual(['Engineering', 'Operations']);
    expect(tree[0]?.children.map((n) => n.name)).toEqual(['Applications', 'Platform']);
    expect(tree[0]?.children[1]?.children.map((n) => n.name)).toEqual(['SRE']);
  });

  it('treats departments whose parent is filtered out (e.g. inactive) as roots', () => {
    const tree = buildDepartmentTree([row('platform', 'Platform', 'eng-inactive')]);
    expect(tree.map((n) => n.id)).toEqual(['platform']);
  });
});

import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button.js';
import { DataTable } from './data-table.js';
import type { DataTableColumnDef } from './data-table-features.js';

interface Person {
  id: string;
  name: string;
  dept: string;
  age: number;
}

const people: Person[] = Array.from({ length: 30 }, (_, i) => ({
  id: `p${String(i + 1)}`,
  name: `Person ${String(i + 1).padStart(2, '0')}`,
  dept: i % 2 ? 'Finance' : 'Engineering',
  age: 20 + i,
}));

const columns: DataTableColumnDef<Person>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'dept', header: 'Department' },
  { accessorKey: 'age', header: 'Age', meta: { align: 'right', numeric: true } },
];

const getRowId = (p: Person) => p.id;

function bodyRows() {
  const [, body] = screen.getAllByRole('rowgroup');
  return within(body as HTMLElement).getAllByRole('row');
}

describe('DataTable (client mode)', () => {
  it('renders headers and the first page', () => {
    render(<DataTable aria-label="People" columns={columns} data={people} getRowId={getRowId} />);
    expect(screen.getByRole('table', { name: 'People' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Name/ })).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByText('1–10 of 30')).toBeInTheDocument();
  });

  it('paginates', async () => {
    const user = userEvent.setup();
    render(<DataTable aria-label="People" columns={columns} data={people} getRowId={getRowId} />);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('11–20 of 30')).toBeInTheDocument();
    expect(screen.getByText('Person 11')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Last page' }));
    expect(screen.getByText('21–30 of 30')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('sorts when a sortable header is clicked and exposes aria-sort', async () => {
    const user = userEvent.setup();
    render(<DataTable aria-label="People" columns={columns} data={people} getRowId={getRowId} />);
    const ageHeader = screen.getByRole('columnheader', { name: /Age/ });
    expect(ageHeader).not.toHaveAttribute('aria-sort');
    // Numeric columns sort descending first (largest values are usually most relevant).
    await user.click(within(ageHeader).getByRole('button'));
    expect(ageHeader).toHaveAttribute('aria-sort', 'descending');
    expect(within(bodyRows()[0] as HTMLElement).getByText('49')).toBeInTheDocument();
    await user.click(within(ageHeader).getByRole('button'));
    expect(ageHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(within(bodyRows()[0] as HTMLElement).getByText('20')).toBeInTheDocument();

    const nameHeader = screen.getByRole('columnheader', { name: /Name/ });
    await user.click(within(nameHeader).getByRole('button'));
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(ageHeader).not.toHaveAttribute('aria-sort');
  });

  it('selects rows and offers bulk actions with the selected originals', async () => {
    const user = userEvent.setup();
    const onExport = vi.fn<(rows: Person[]) => void>();
    render(
      <DataTable
        aria-label="People"
        columns={columns}
        data={people}
        getRowId={getRowId}
        enableRowSelection
        bulkActions={(rows) => (
          <Button
            size="sm"
            onClick={() => {
              onExport(rows);
            }}
          >
            Export
          </Button>
        )}
      />,
    );
    await user.click(screen.getAllByRole('checkbox', { name: 'Select row' })[1] as HTMLElement);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(onExport).toHaveBeenCalledWith([people[1]]);

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    expect(screen.getByText('10 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  });

  it('supports keyboard row navigation and activation', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn<(p: Person) => void>();
    render(
      <DataTable
        aria-label="People"
        columns={columns}
        data={people}
        getRowId={getRowId}
        onRowActivate={onActivate}
      />,
    );
    const [first, second] = bodyRows();
    first?.focus();
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledWith(people[1]);
  });

  it('shows the empty state', () => {
    render(
      <DataTable
        aria-label="People"
        columns={columns}
        data={[]}
        getRowId={getRowId}
        emptyTitle="No employees yet"
      />,
    );
    expect(screen.getByText('No employees yet')).toBeInTheDocument();
    expect(screen.getByText('No rows')).toBeInTheDocument();
  });

  it('shows the error state with retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn<() => void>();
    render(
      <DataTable
        aria-label="People"
        columns={columns}
        data={[]}
        getRowId={getRowId}
        error="Network down"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders loading skeletons and marks the table busy', () => {
    render(
      <DataTable aria-label="People" columns={columns} data={[]} getRowId={getRowId} isLoading />,
    );
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No records found')).not.toBeInTheDocument();
  });
});

describe('DataTable (server mode)', () => {
  it('does not slice data and delegates pagination to the caller', async () => {
    const user = userEvent.setup();
    const onPaginationChange = vi.fn();
    const page = people.slice(0, 25);
    render(
      <DataTable
        aria-label="People"
        mode="server"
        columns={columns}
        data={page}
        getRowId={getRowId}
        rowCount={1000}
        pagination={{ pageIndex: 0, pageSize: 25 }}
        onPaginationChange={onPaginationChange}
        sorting={[]}
        onSortingChange={vi.fn()}
      />,
    );
    expect(bodyRows()).toHaveLength(25);
    expect(screen.getByText('1–25 of 1000')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 40')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPaginationChange).toHaveBeenCalled();
  });
});

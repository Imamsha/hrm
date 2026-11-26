import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  Textarea,
} from '@hrm/ui-web';
import { portalRequestSchema } from '@hrm/validation';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { saveDownload } from '@/features/recruitment/recruit-api';
import { ResourceForm } from '@/features/structure/resource-form';
import { api, errorMessage } from '@/lib/api';
import { InvoiceView } from './billing-pages';
import { Bar } from './project-pages';
import {
  label,
  PROJECTS,
  usePortal,
  usePortalInvoice,
  usePortalItem,
  usePortalItems,
  VARIANT,
  useAct,
} from './projects-api';

const Status = ({ s }: { s: string }) => (
  <Badge variant={VARIANT[s] ?? 'neutral'}>{label(s)}</Badge>
);

/** Client portal home: the client's shared projects and issued invoices (ADR-017). */
export function PortalHomePage() {
  const portal = usePortal();
  if (portal.isPending)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (portal.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(portal.error)} />
      </Page>
    );
  const s = portal.data;
  return (
    <Page>
      <PageHeader
        title={`${s.client.name} — client portal`}
        description="Progress on your projects, your requests and your invoices."
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_26rem]">
        <Card>
          <CardHeader>
            <CardTitle>Projects</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!s.projects.length ? (
              <p className="p-4 text-sm text-muted-foreground">
                No projects are shared with you yet.
              </p>
            ) : (
              <ul className="divide-y divide-border text-sm" aria-label="Portal projects">
                {s.projects.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <Link
                      to={`/portal/projects/${p.id}`}
                      className="min-w-0 flex-1 font-medium text-primary hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.openBugs ? <Badge variant="warning">{p.openBugs} open bugs</Badge> : null}
                    <span className="w-32">
                      <Bar value={p.progress.percentDone} />
                      <span className="text-xs text-muted-foreground">
                        {p.progress.percentDone}% done
                      </span>
                    </span>
                    <Status s={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-border text-sm" aria-label="Portal invoices">
              {s.invoices.map((i) => (
                <li key={i.id} className="flex items-center gap-2 px-4 py-2">
                  <Link
                    to={`/portal/invoices/${i.id}`}
                    className="min-w-0 flex-1 text-primary hover:underline"
                  >
                    {i.number}
                  </Link>
                  <span>
                    {i.currency} {i.total}
                  </span>
                  {i.overdue ? (
                    <Badge variant="destructive">overdue</Badge>
                  ) : (
                    <Status s={i.status} />
                  )}
                </li>
              ))}
              {!s.invoices.length ? (
                <li className="p-4 text-muted-foreground">No invoices.</li>
              ) : null}
            </ul>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}

export function PortalProjectPage() {
  const { id = '' } = useParams<{ id: string }>();
  const portal = usePortal();
  const items = usePortalItems(id);
  const [raising, setRaising] = useState(false);
  const project = portal.data?.projects.find((p) => p.id === id);
  return (
    <Page>
      <PageHeader
        title={project?.name ?? 'Project'}
        description="Items the team shares with you, including your requests."
        actions={
          <Button
            onClick={() => {
              setRaising(true);
            }}
          >
            <Plus /> Report a bug or request
          </Button>
        }
      />
      {items.isError ? (
        <ErrorState description={errorMessage(items.error)} />
      ) : !items.data?.length ? (
        <EmptyState title="Nothing shared yet" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border text-sm" aria-label="Shared items">
              {items.data.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                  <Link to={`/portal/items/${w.id}`} className="text-primary hover:underline">
                    {w.key}
                  </Link>
                  <span className="min-w-0 flex-1">
                    {w.title}{' '}
                    <span className="text-muted-foreground">
                      · {label(w.type)}
                      {w.fromClient ? ' · your request' : ''}
                    </span>
                  </span>
                  {w.severity ? <Status s={w.severity} /> : null}
                  <Badge variant={VARIANT[w.category] ?? 'neutral'}>{w.status}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Dialog open={raising} onOpenChange={setRaising}>
        <DialogContent>
          <DialogHeader title="Report a bug or request" />
          <ResourceForm
            fields={[
              {
                name: 'type',
                label: 'Type',
                kind: 'select',
                required: true,
                options: [
                  { value: 'BUG', label: 'Bug' },
                  { value: 'STORY', label: 'Request / change' },
                ],
              },
              { name: 'title', label: 'Title', required: true },
              {
                name: 'severity',
                label: 'Severity',
                kind: 'select',
                required: true,
                placeholder: 'Select…',
                options: ['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR'].map((s) => ({
                  value: s,
                  label: label(s),
                })),
                show: (v) => v.type === 'BUG',
              },
              { name: 'description', label: 'Description', kind: 'textarea', required: true },
              {
                name: 'stepsToReproduce',
                label: 'Steps to reproduce',
                kind: 'textarea',
                show: (v) => v.type === 'BUG',
              },
            ]}
            defaultValues={{
              type: 'BUG',
              title: '',
              severity: '',
              description: '',
              stepsToReproduce: '',
            }}
            schema={portalRequestSchema}
            extra={{ projectId: id }}
            submit={(body) => api.post('/portal/requests', body)}
            invalidate={[PROJECTS]}
            submitLabel="Send"
            onDone={() => {
              setRaising(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </Page>
  );
}

export function PortalItemPage() {
  const { id = '' } = useParams<{ id: string }>();
  const item = usePortalItem(id);
  const { error, run } = useAct();
  const [body, setBody] = useState('');
  if (item.isPending)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (item.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(item.error)} />
      </Page>
    );
  const w = item.data;
  return (
    <Page>
      <PageHeader
        title={`${w.key} ${w.title}`}
        description={`${label(w.type)} in ${w.project.name}`}
        actions={<Badge variant={VARIANT[w.category] ?? 'neutral'}>{w.status}</Badge>}
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-2 py-4 text-sm">
          {w.description ? <p className="whitespace-pre-wrap">{w.description}</p> : null}
          {w.stepsToReproduce ? (
            <p className="whitespace-pre-wrap text-muted-foreground">{w.stepsToReproduce}</p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Conversation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <ul className="flex flex-col gap-2" aria-label="Conversation">
            {w.comments.map((c) => (
              <li
                key={c.id}
                className={`rounded border border-border p-2 ${c.fromClient ? 'bg-muted/50' : ''}`}
              >
                <p className="text-xs text-muted-foreground">
                  {c.author} · {new Date(c.createdAt).toLocaleString()}
                </p>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ul>
          <Textarea
            aria-label="Your reply"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
            }}
          />
          <div>
            <Button
              size="sm"
              disabled={!body.trim()}
              onClick={() => {
                run.mutate(() => api.post(`/portal/items/${w.id}/comments`, { body }), {
                  onSuccess: () => {
                    setBody('');
                  },
                });
              }}
            >
              Reply
            </Button>
          </div>
        </CardContent>
      </Card>
    </Page>
  );
}

export function PortalInvoicePage() {
  const { id = '' } = useParams<{ id: string }>();
  const invoice = usePortalInvoice(id);
  if (invoice.isPending)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (invoice.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(invoice.error)} />
      </Page>
    );
  return (
    <Page>
      <PageHeader
        title={`Invoice ${invoice.data.number ?? ''}`}
        description={`${invoice.data.currency} ${invoice.data.total} · ${label(invoice.data.status)}`}
        actions={
          <Button
            variant="outline"
            onClick={() => {
              void saveDownload(
                `/portal/invoices/${id}/pdf`,
                `${invoice.data.number ?? 'Invoice'}.pdf`,
              );
            }}
          >
            Download PDF
          </Button>
        }
      />
      <InvoiceView inv={invoice.data} />
    </Page>
  );
}

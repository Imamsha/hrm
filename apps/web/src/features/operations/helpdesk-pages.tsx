import type { HelpdeskCategoryItem, TicketStatusValue } from '@hrm/shared-types';
import { PERMISSIONS } from '@hrm/shared-types';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  ErrorState,
  FormField,
  FormGrid,
  Input,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@hrm/ui-web';
import { helpdeskCategorySchema, ticketSchema } from '@hrm/validation';
import { Paperclip, Plus, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Page, PageHeader } from '@/app/layout/page';
import { usePermission } from '@/features/auth/auth-store';
import { authorizedFetch, saveDownload } from '@/features/recruitment/recruit-api';
import { type RefRow, useRefOptions } from '@/features/structure/api';
import { api, errorMessage } from '@/lib/api';
import {
  label,
  useAct,
  useArticles,
  useCategories,
  useTicket,
  useTickets,
  VARIANT,
} from './operations-api';

const P = PERMISSIONS;
const employeeRef = {
  path: '/employees',
  label: (r: RefRow) => `${String(r.displayName)} (${String(r.employeeNumber)})`,
};
const Status = ({ s }: { s: string }) => (
  <Badge variant={VARIANT[s] ?? 'neutral'}>{label(s)}</Badge>
);
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

// ------------------------------------------------------------------------------ list

function NewTicket({ onDone }: { onDone: (id: string) => void }) {
  const categories = useCategories();
  const { error, setError, run } = useAct();
  const [v, setV] = useState({ categoryId: '', subject: '', description: '', priority: 'MEDIUM' });
  const suggestions = useArticles(v.subject.trim().length >= 4 ? v.subject : undefined);
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          <FormField label="Category" required>
            <Select
              value={v.categoryId}
              placeholder="Select…"
              options={(categories.data ?? [])
                .filter((c) => c.status === 'ACTIVE')
                .map((c) => ({ value: c.id, label: c.name }))}
              onChange={(e) => {
                setV({ ...v, categoryId: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Priority" required>
            <Select
              value={v.priority}
              options={PRIORITIES.map((p) => ({ value: p, label: label(p) }))}
              onChange={(e) => {
                setV({ ...v, priority: e.target.value });
              }}
            />
          </FormField>
        </FormGrid>
        <FormField label="Subject" required>
          <Input
            value={v.subject}
            onChange={(e) => {
              setV({ ...v, subject: e.target.value });
            }}
          />
        </FormField>
        {v.subject.trim().length >= 4 && suggestions.data?.length ? (
          <Alert tone="info">
            <span className="font-medium">These articles may help:</span>
            <ul className="mt-1 list-disc pl-5" aria-label="Suggested articles">
              {suggestions.data.slice(0, 3).map((a) => (
                <li key={a.id}>
                  <Link
                    to={`/helpdesk/knowledge?article=${a.id}`}
                    className="text-primary hover:underline"
                  >
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <FormField label="Description" required>
          <Textarea
            value={v.description}
            onChange={(e) => {
              setV({ ...v, description: e.target.value });
            }}
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button
          onClick={() => {
            const parsed = ticketSchema.safeParse(v);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Check the ticket');
              return;
            }
            run.mutate(() =>
              api.post<{ id: string }>('/helpdesk/tickets', v).then((t) => {
                onDone(t.id);
              }),
            );
          }}
        >
          Raise ticket
        </Button>
      </DialogFooter>
    </>
  );
}

function TicketTable({ scope }: { scope: 'mine' | 'queue' | 'all' }) {
  const tickets = useTickets({ scope });
  if (tickets.isPending) return <Skeleton className="h-32" />;
  if (!tickets.data?.length)
    return (
      <EmptyState
        title={scope === 'mine' ? 'You have not raised any tickets' : 'The queue is empty'}
      />
    );
  return (
    <Card>
      <CardContent className="p-0">
        <table
          className="w-full text-sm"
          aria-label={scope === 'mine' ? 'My tickets' : 'Ticket queue'}
        >
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-normal">Ticket</th>
              <th className="px-3 py-2 font-normal">Category</th>
              {scope !== 'mine' ? <th className="px-3 py-2 font-normal">Requester</th> : null}
              <th className="px-3 py-2 font-normal">Priority</th>
              <th className="px-3 py-2 font-normal">Due</th>
              <th className="px-3 py-2 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {tickets.data.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <Link to={`/helpdesk/tickets/${t.id}`} className="text-primary hover:underline">
                    {t.number}
                  </Link>{' '}
                  {t.subject}
                </td>
                <td className="px-3 py-2">{t.category.name}</td>
                {scope !== 'mine' ? (
                  <td className="px-3 py-2">
                    {t.requester.displayName}
                    {t.assignee ? (
                      <span className="block text-xs text-muted-foreground">
                        → {t.assignee.displayName}
                      </span>
                    ) : null}
                  </td>
                ) : null}
                <td className="px-3 py-2">
                  <Status s={t.priority} />
                </td>
                <td className="px-3 py-2">
                  {t.resolutionDue ? new Date(t.resolutionDue).toLocaleString() : '—'}
                  {t.resolutionBreached || t.responseBreached ? (
                    <Badge variant="destructive" className="ml-1">
                      SLA breached
                    </Badge>
                  ) : null}
                  {t.escalated ? (
                    <Badge variant="warning" className="ml-1">
                      escalated
                    </Badge>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <Status s={t.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export function HelpdeskPage() {
  const manage = usePermission(P.HELPDESK_TICKET_MANAGE);
  const queue = useTickets({ scope: 'queue' });
  const isAgent = manage || (queue.data?.length ?? 0) > 0;
  const [tab, setTab] = useState('mine');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  return (
    <Page>
      <PageHeader
        title="Helpdesk"
        description="Ask HR, payroll, IT or anyone the organization set up for help."
        actions={
          <Button
            onClick={() => {
              setCreating(true);
            }}
          >
            <Plus /> New ticket
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Ticket views">
          <TabsTrigger value="mine">My tickets</TabsTrigger>
          {isAgent ? (
            <TabsTrigger value="queue">Queue ({queue.data?.length ?? 0})</TabsTrigger>
          ) : null}
          {isAgent ? <TabsTrigger value="all">All I can work</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="mine">
          <TicketTable scope="mine" />
        </TabsContent>
        <TabsContent value="queue">
          <TicketTable scope="queue" />
        </TabsContent>
        <TabsContent value="all">
          <TicketTable scope="all" />
        </TabsContent>
      </Tabs>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent size="lg">
          <DialogHeader title="New ticket" />
          {creating ? (
            <NewTicket
              onDone={(id) => {
                setCreating(false);
                void navigate(`/helpdesk/tickets/${id}`);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ ticket

export function TicketPage() {
  const { id = '' } = useParams<{ id: string }>();
  const ticket = useTicket(id);
  const categories = useCategories();
  const { error, setError, run } = useAct();
  const [reply, setReply] = useState({ body: '', internal: false });
  const [resolution, setResolution] = useState('');
  const [rating, setRating] = useState('');
  if (ticket.isPending)
    return (
      <Page>
        <Skeleton className="h-40" />
      </Page>
    );
  if (ticket.isError)
    return (
      <Page>
        <ErrorState description={errorMessage(ticket.error)} />
      </Page>
    );
  const t = ticket.data;
  const category = categories.data?.find((c) => c.id === t.category.id);
  const patch = (body: object) => {
    run.mutate(() => api.patch(`/helpdesk/tickets/${id}`, body));
  };
  const nextStatuses: TicketStatusValue[] =
    t.status === 'OPEN'
      ? ['IN_PROGRESS', 'WAITING_ON_REQUESTER']
      : t.status === 'IN_PROGRESS'
        ? ['WAITING_ON_REQUESTER', 'OPEN']
        : t.status === 'WAITING_ON_REQUESTER'
          ? ['IN_PROGRESS']
          : [];
  return (
    <Page>
      <PageHeader
        title={`${t.number} ${t.subject}`}
        description={`${t.category.name} · raised by ${t.requester.displayName} · ${when(t.createdAt)}`}
        actions={
          <>
            <Status s={t.priority} />
            <Status s={t.status} />
          </>
        }
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="py-4 text-sm">
              <p className="whitespace-pre-wrap">{t.description}</p>
            </CardContent>
          </Card>
          {t.resolution ? <Alert tone="success">Resolution: {t.resolution}</Alert> : null}
          <Card>
            <CardHeader>
              <CardTitle>Conversation</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <ul className="flex flex-col gap-2" aria-label="Conversation">
                {t.comments.map((c) => (
                  <li
                    key={c.id}
                    className={`rounded border p-2 ${c.internal ? 'border-warning bg-warning/10' : 'border-border'}`}
                  >
                    <p className="text-xs text-muted-foreground">
                      {c.author ?? 'Someone'} · {when(c.createdAt)}
                      {c.internal ? ' · internal note' : ''}
                    </p>
                    <p className="whitespace-pre-wrap">{c.body}</p>
                  </li>
                ))}
                {!t.comments.length ? (
                  <li className="text-muted-foreground">No replies yet.</li>
                ) : null}
              </ul>
              {t.can.comment ? (
                <div className="flex flex-col gap-2">
                  <Textarea
                    aria-label="Reply"
                    value={reply.body}
                    onChange={(e) => {
                      setReply({ ...reply, body: e.target.value });
                    }}
                  />
                  <div className="flex items-center gap-3">
                    {t.can.internal ? (
                      <label className="flex items-center gap-2">
                        <Checkbox
                          checked={reply.internal}
                          onCheckedChange={(c) => {
                            setReply({ ...reply, internal: c === true });
                          }}
                        />{' '}
                        Internal note (agents only)
                      </label>
                    ) : null}
                    <label className="cursor-pointer text-primary hover:underline">
                      <Paperclip className="inline size-3" /> Attach
                      <input
                        type="file"
                        className="sr-only"
                        aria-label="Attach file"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const form = new FormData();
                          form.append('file', f);
                          run.mutate(() =>
                            authorizedFetch(`/helpdesk/tickets/${id}/attachments`, {
                              method: 'POST',
                              body: form,
                            }),
                          );
                        }}
                      />
                    </label>
                    <Button
                      size="sm"
                      className="ml-auto"
                      disabled={!reply.body.trim()}
                      onClick={() => {
                        run.mutate(() => api.post(`/helpdesk/tickets/${id}/comments`, reply), {
                          onSuccess: () => {
                            setReply({ body: '', internal: false });
                          },
                        });
                      }}
                    >
                      Send
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-2 py-4 text-sm">
              <dl className="grid grid-cols-2 gap-1">
                <dt className="text-muted-foreground">Assignee</dt>
                <dd>{t.assignee?.displayName ?? 'Unassigned'}</dd>
                <dt className="text-muted-foreground">First response due</dt>
                <dd>
                  {when(t.firstResponseDue)}
                  {t.responseBreached ? ' (missed)' : ''}
                </dd>
                <dt className="text-muted-foreground">Resolution due</dt>
                <dd>
                  {when(t.resolutionDue)}
                  {t.resolutionBreached ? ' (missed)' : ''}
                </dd>
              </dl>
              {t.can.work ? (
                <>
                  <FormField label="Assign to">
                    <Select
                      value={t.assignee?.id ?? ''}
                      options={[
                        { value: '', label: 'Unassigned' },
                        ...(category?.agents ?? []).map((a) => ({
                          value: a.id,
                          label: a.displayName,
                        })),
                      ]}
                      onChange={(e) => {
                        patch({ assigneeId: e.target.value || null });
                      }}
                    />
                  </FormField>
                  <FormField label="Priority">
                    <Select
                      value={t.priority}
                      options={PRIORITIES.map((p) => ({ value: p, label: label(p) }))}
                      onChange={(e) => {
                        patch({ priority: e.target.value });
                      }}
                    />
                  </FormField>
                  <div className="flex flex-wrap gap-1">
                    {nextStatuses.map((s) => (
                      <Button
                        key={s}
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          patch({ status: s });
                        }}
                      >
                        {label(s)}
                      </Button>
                    ))}
                  </div>
                  {t.status !== 'RESOLVED' && t.status !== 'CLOSED' ? (
                    <div className="flex flex-col gap-1">
                      <Textarea
                        aria-label="Resolution"
                        placeholder="How was it resolved?"
                        value={resolution}
                        onChange={(e) => {
                          setResolution(e.target.value);
                        }}
                      />
                      <Button
                        size="sm"
                        disabled={!resolution.trim()}
                        onClick={() => {
                          patch({ status: 'RESOLVED', resolution });
                        }}
                      >
                        Resolve
                      </Button>
                    </div>
                  ) : null}
                </>
              ) : null}
              {t.can.reopen ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    patch({ status: 'OPEN' });
                  }}
                >
                  Not fixed — reopen
                </Button>
              ) : null}
              {t.can.close ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    patch({ status: 'CLOSED' });
                  }}
                >
                  Close
                </Button>
              ) : null}
              {t.can.rate ? (
                <div className="flex items-end gap-2">
                  <FormField label="How did we do?">
                    <Select
                      value={rating}
                      placeholder="Rate…"
                      options={['5', '4', '3', '2', '1'].map((r) => ({
                        value: r,
                        label: `${r} / 5`,
                      }))}
                      onChange={(e) => {
                        setRating(e.target.value);
                      }}
                    />
                  </FormField>
                  <Button
                    size="sm"
                    disabled={!rating}
                    onClick={() => {
                      run.mutate(() =>
                        api.post(`/helpdesk/tickets/${id}/rating`, {
                          rating: Number(rating),
                          comment: null,
                        }),
                      );
                    }}
                  >
                    Rate
                  </Button>
                </div>
              ) : t.rating ? (
                <p>Rated {t.rating}/5</p>
              ) : null}
            </CardContent>
          </Card>
          {t.attachments.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Attachments</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1 text-sm">
                {t.attachments.map((a) => (
                  <Button
                    key={a.id}
                    size="xs"
                    variant="ghost"
                    className="justify-start"
                    onClick={() => {
                      saveDownload(`/helpdesk/tickets/${id}/attachments/${a.id}`, a.fileName).catch(
                        (e: unknown) => {
                          setError(errorMessage(e));
                        },
                      );
                    }}
                  >
                    <Paperclip /> {a.fileName}
                  </Button>
                ))}
              </CardContent>
            </Card>
          ) : null}
          {t.history.length ? (
            <Card>
              <CardHeader>
                <CardTitle>History</CardTitle>
              </CardHeader>
              <CardContent>
                <ol
                  className="flex flex-col gap-1 text-xs text-muted-foreground"
                  aria-label="History"
                >
                  {t.history.map((h, i) => (
                    <li key={i}>
                      {when(h.at)} · {h.actor ?? 'system'} · {h.action}
                      {h.from || h.to ? `: ${h.from ?? '—'} → ${h.to ?? '—'}` : ''}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </Page>
  );
}

// ------------------------------------------------------------------------------ knowledge base

export function KnowledgePage() {
  const manage = usePermission(P.HELPDESK_KNOWLEDGE_MANAGE);
  const [search, setSearch] = useState('');
  const articles = useArticles(search.trim().length >= 3 ? search : undefined);
  const categories = useCategories();
  const { error, setError, run } = useAct();
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    id?: string;
    title: string;
    body: string;
    categoryId: string;
    status: string;
  } | null>(null);
  return (
    <Page>
      <PageHeader
        title="Knowledge base"
        description="Answers to common questions."
        actions={
          manage ? (
            <Button
              onClick={() => {
                setEditing({ title: '', body: '', categoryId: '', status: 'DRAFT' });
              }}
            >
              <Plus /> New article
            </Button>
          ) : null
        }
      />
      {error ? (
        <Alert tone="destructive" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <Input
        aria-label="Search articles"
        placeholder="Search…"
        className="mb-3 max-w-md"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
        }}
      />
      {!articles.data?.length ? (
        <EmptyState title="No articles" />
      ) : (
        <div className="flex flex-col gap-2" aria-label="Articles">
          {articles.data.map((a) => (
            <Card key={a.id}>
              <CardHeader>
                <CardTitle>
                  <button
                    type="button"
                    className="text-left hover:underline"
                    onClick={() => {
                      setOpen(open === a.id ? null : a.id);
                    }}
                  >
                    {a.title}
                  </button>
                </CardTitle>
                {a.category ? <Badge variant="neutral">{a.category.name}</Badge> : null}
                {manage ? <Status s={a.status} /> : null}
                {manage ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => {
                      setEditing({
                        id: a.id,
                        title: a.title,
                        body: a.body,
                        categoryId: a.category?.id ?? '',
                        status: a.status,
                      });
                    }}
                  >
                    Edit
                  </Button>
                ) : null}
              </CardHeader>
              {open === a.id ? (
                <CardContent className="flex flex-col gap-2 text-sm">
                  <p className="whitespace-pre-wrap">{a.body}</p>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    Was this helpful?
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label="Helpful"
                      onClick={() => {
                        run.mutate(() =>
                          api.post(`/helpdesk/articles/${a.id}/vote`, { helpful: true }),
                        );
                      }}
                    >
                      <ThumbsUp /> {a.helpful}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label="Not helpful"
                      onClick={() => {
                        run.mutate(() =>
                          api.post(`/helpdesk/articles/${a.id}/vote`, { helpful: false }),
                        );
                      }}
                    >
                      <ThumbsDown /> {a.notHelpful}
                    </Button>
                  </div>
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogContent size="lg">
          <DialogHeader title={editing?.id ? 'Edit article' : 'New article'} />
          {editing ? (
            <>
              <DialogBody className="flex flex-col gap-3">
                <FormGrid columns={2}>
                  <FormField label="Category">
                    <Select
                      value={editing.categoryId}
                      options={[
                        { value: '', label: 'General' },
                        ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
                      ]}
                      onChange={(e) => {
                        setEditing({ ...editing, categoryId: e.target.value });
                      }}
                    />
                  </FormField>
                  <FormField label="Status">
                    <Select
                      value={editing.status}
                      options={['DRAFT', 'PUBLISHED', 'ARCHIVED'].map((s) => ({
                        value: s,
                        label: label(s),
                      }))}
                      onChange={(e) => {
                        setEditing({ ...editing, status: e.target.value });
                      }}
                    />
                  </FormField>
                </FormGrid>
                <FormField label="Title" required>
                  <Input
                    value={editing.title}
                    onChange={(e) => {
                      setEditing({ ...editing, title: e.target.value });
                    }}
                  />
                </FormField>
                <FormField label="Text" required>
                  <Textarea
                    className="min-h-60"
                    value={editing.body}
                    onChange={(e) => {
                      setEditing({ ...editing, body: e.target.value });
                    }}
                  />
                </FormField>
              </DialogBody>
              <DialogFooter>
                <Button
                  onClick={() => {
                    if (!editing.title.trim() || !editing.body.trim()) {
                      setError('Give a title and a text');
                      return;
                    }
                    const body = {
                      title: editing.title,
                      body: editing.body,
                      status: editing.status,
                      categoryId: editing.categoryId || null,
                    };
                    run.mutate(
                      () =>
                        editing.id
                          ? api.patch(`/helpdesk/articles/${editing.id}`, body)
                          : api.post('/helpdesk/articles', body),
                      {
                        onSuccess: () => {
                          setEditing(null);
                        },
                      },
                    );
                  }}
                >
                  Save
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

// ------------------------------------------------------------------------------ setup

function CategoryEditor({
  category,
  onDone,
}: {
  category: HelpdeskCategoryItem | null;
  onDone: () => void;
}) {
  const employees = useRefOptions(employeeRef, { status: 'ACTIVE' });
  const { error, setError, run } = useAct();
  const [v, setV] = useState({
    code: category?.code ?? '',
    name: category?.name ?? '',
    description: category?.description ?? '',
    confidential: category?.confidential ?? false,
    defaultAssigneeId: category?.defaultAssignee?.id ?? '',
    escalationEmployeeId: category?.escalationContact?.id ?? '',
  });
  const [agents, setAgents] = useState<string[]>(category?.agents.map((a) => a.id) ?? []);
  const [sla, setSla] = useState<
    Record<string, { firstResponseHours: string; resolutionHours: string }>
  >(
    Object.fromEntries(
      PRIORITIES.map((p) => {
        const s = category?.sla.find((x) => x.priority === p);
        return [
          p,
          {
            firstResponseHours: s?.firstResponseHours ? String(s.firstResponseHours) : '',
            resolutionHours: s?.resolutionHours ? String(s.resolutionHours) : '',
          },
        ];
      }),
    ),
  );
  const name = (id: string) => employees.data?.find((e) => e.value === id)?.label ?? id;
  return (
    <>
      <DialogBody className="flex flex-col gap-3">
        {error ? <Alert tone="destructive">{error}</Alert> : null}
        <FormGrid columns={2}>
          {!category ? (
            <FormField label="Code" required>
              <Input
                value={v.code}
                onChange={(e) => {
                  setV({ ...v, code: e.target.value });
                }}
              />
            </FormField>
          ) : null}
          <FormField label="Name" required>
            <Input
              value={v.name}
              onChange={(e) => {
                setV({ ...v, name: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Default assignee">
            <Select
              value={v.defaultAssigneeId}
              options={[
                { value: '', label: 'None' },
                ...agents.map((a) => ({ value: a, label: name(a) })),
              ]}
              onChange={(e) => {
                setV({ ...v, defaultAssigneeId: e.target.value });
              }}
            />
          </FormField>
          <FormField label="Escalation contact" description="Late tickets are reassigned here.">
            <Select
              value={v.escalationEmployeeId}
              options={[{ value: '', label: 'None' }, ...(employees.data ?? [])]}
              onChange={(e) => {
                setV({ ...v, escalationEmployeeId: e.target.value });
              }}
            />
          </FormField>
        </FormGrid>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={v.confidential}
            onCheckedChange={(c) => {
              setV({ ...v, confidential: c === true });
            }}
          />{' '}
          Confidential: only this category's agents see its tickets
        </label>
        <FormField label="Agents" required>
          <Select
            value=""
            placeholder="Add an agent…"
            options={(employees.data ?? []).filter((e) => !agents.includes(e.value))}
            onChange={(e) => {
              if (e.target.value) setAgents([...agents, e.target.value]);
            }}
          />
        </FormField>
        <ul className="flex flex-wrap gap-1" aria-label="Chosen agents">
          {agents.map((a) => (
            <li key={a}>
              <Badge variant="neutral">
                {name(a)}{' '}
                <button
                  type="button"
                  aria-label={`Remove ${name(a)}`}
                  onClick={() => {
                    setAgents(agents.filter((x) => x !== a));
                  }}
                >
                  ×
                </button>
              </Badge>
            </li>
          ))}
        </ul>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="font-medium">SLA (hours; blank = none)</legend>
          {PRIORITIES.map((p) => (
            <div key={p} className="flex items-center gap-2">
              <span className="w-20">{label(p)}</span>
              <Input
                aria-label={`${p} first response hours`}
                className="w-32"
                placeholder="First response"
                value={sla[p]?.firstResponseHours ?? ''}
                onChange={(e) => {
                  setSla({
                    ...sla,
                    [p]: {
                      firstResponseHours: e.target.value,
                      resolutionHours: sla[p]?.resolutionHours ?? '',
                    },
                  });
                }}
              />
              <Input
                aria-label={`${p} resolution hours`}
                className="w-32"
                placeholder="Resolution"
                value={sla[p]?.resolutionHours ?? ''}
                onChange={(e) => {
                  setSla({
                    ...sla,
                    [p]: {
                      firstResponseHours: sla[p]?.firstResponseHours ?? '',
                      resolutionHours: e.target.value,
                    },
                  });
                }}
              />
            </div>
          ))}
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            const body = {
              ...v,
              description: v.description || null,
              defaultAssigneeId: v.defaultAssigneeId || null,
              escalationEmployeeId: v.escalationEmployeeId || null,
              agentEmployeeIds: agents,
              sla: PRIORITIES.filter(
                (p) => sla[p]?.firstResponseHours || sla[p]?.resolutionHours,
              ).map((p) => ({
                priority: p,
                firstResponseHours: sla[p]?.firstResponseHours || null,
                resolutionHours: sla[p]?.resolutionHours || null,
              })),
            };
            const parsed = helpdeskCategorySchema.safeParse(
              category ? { ...body, code: category.code } : body,
            );
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Check the category');
              return;
            }
            const { code: _code, ...update } = body;
            run.mutate(
              () =>
                category
                  ? api.put(`/helpdesk/categories/${category.id}`, update)
                  : api.post('/helpdesk/categories', body),
              { onSuccess: onDone },
            );
          }}
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

export function HelpdeskSetupPage() {
  const categories = useCategories();
  const [editing, setEditing] = useState<HelpdeskCategoryItem | 'new' | null>(null);
  return (
    <Page>
      <PageHeader
        title="Helpdesk setup"
        description="Your categories, the agents who work them and your SLAs. Nothing is pre-filled."
        actions={
          <Button
            onClick={() => {
              setEditing('new');
            }}
          >
            <Plus /> New category
          </Button>
        }
      />
      {!categories.data?.length ? (
        <EmptyState
          title="No categories yet"
          description="Employees can raise tickets once a category exists."
        />
      ) : (
        <div className="flex flex-col gap-2" aria-label="Categories">
          {categories.data.map((c) => (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle>{c.name}</CardTitle>
                <span className="text-sm text-muted-foreground">
                  {c.code} · {c.agents.map((a) => a.displayName).join(', ')}
                  {c.confidential ? ' · confidential' : ''}
                </span>
                <Status s={c.status} />
                <Button
                  size="xs"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => {
                    setEditing(c);
                  }}
                >
                  Edit
                </Button>
              </CardHeader>
              {c.sla.length ? (
                <CardContent className="text-sm text-muted-foreground">
                  SLA:{' '}
                  {c.sla
                    .map(
                      (s) =>
                        `${label(s.priority)} ${s.firstResponseHours ? `${String(s.firstResponseHours)} h response` : ''}${s.firstResponseHours && s.resolutionHours ? ', ' : ''}${s.resolutionHours ? `${String(s.resolutionHours)} h resolution` : ''}`,
                    )
                    .join(' · ')}
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      >
        <DialogContent size="lg">
          <DialogHeader
            title={editing === 'new' ? 'New category' : `Edit ${editing?.name ?? ''}`}
          />
          {editing ? (
            <CategoryEditor
              category={editing === 'new' ? null : editing}
              onDone={() => {
                setEditing(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

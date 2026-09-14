'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Inbox, Loader2 } from 'lucide-react';
import { useAnalytics } from '@/lib/analytics-context';
import { num } from '@/lib/analytics';
import { Pill, StatCard, fmt } from '@/components/ui';
import { apiFetch } from '@/lib/api.client';

/**
 * Support tickets.
 *
 * The only screen in this dashboard that writes anything, and the only one
 * that talks to the FastAPI backend rather than the analytics function: a
 * ticket is a live queue an admin works through, not a number to look at, so
 * it is read fresh and updated in place. The counters above it come from the
 * shared analytics document like everything else.
 */

interface Ticket {
  id: string;
  email: string;
  ticket_type: string;
  priority: number;
  subject: string;
  message: string;
  user_id: string | null;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

const PRIORITY_LABELS: Record<number, string> = { 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' };

const PRIORITY_COLORS: Record<number, string> = {
  1: 'bg-red-100 font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-400',
  2: 'bg-amber-100 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  3: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  4: 'bg-raised text-muted',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  in_progress: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  closed: 'bg-raised text-muted',
};

const TICKET_TYPE_LABELS: Record<string, string> = {
  feedback: 'Feedback',
  billing: 'Billing',
  technical: 'Technical',
  feature_request: 'Feature req.',
  account: 'Account',
  other: 'Other',
};

const TICKET_TYPE_COLORS: Record<string, string> = {
  feedback: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400',
  billing: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  technical: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  feature_request: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  account: 'bg-raised text-muted',
  other: 'bg-raised text-faint',
};

export default function SupportPage() {
  const { data } = useAnalytics();
  const canEdit = data ? data.caller_role !== 'user' : false;

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  // The fetch holds no state of its own, so the effect can start it without a
  // cascading render: the result arrives in a promise callback, which is the
  // shape React wants for subscribing to something outside itself.
  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (filterStatus) params.set('status', filterStatus);
    if (filterType) params.set('ticket_type', filterType);
    const qs = params.toString() ? `?${params}` : '';

    apiFetch<{ tickets: Ticket[]; total: number }>(`/support/admin/tickets${qs}`)
      .then((body) => {
        setError('');
        setTickets(body.tickets);
        setTotal(body.total);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not load tickets.');
      })
      .finally(() => setLoading(false));
  }, [filterStatus, filterType]);

  useEffect(() => { load(); }, [load]);

  async function updateTicket(id: string, payload: { status?: string; admin_notes?: string }) {
    setUpdating(id);
    try {
      await apiFetch(`/support/admin/tickets/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the ticket.');
    } finally {
      setUpdating(null);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Support</h1>
        <p className="mt-1 text-sm text-muted">
          Tickets are read live from the backend, so what you see here is current even
          when the rest of the dashboard is a minute old.
        </p>
      </header>

      {data && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Open"
            value={num(data.support.open)}
            tone={data.support.open > 0 ? 'warning' : undefined}
            sub={`${data.support.new_7d} new in 7 days`}
          />
          <StatCard label="In progress" value={num(data.support.in_progress)} />
          <StatCard label="Resolved" value={num(data.support.resolved)} />
          <StatCard label="All tickets" value={num(data.support.total)} />
        </section>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {['', 'open', 'in_progress', 'resolved', 'closed'].map((s) => (
            <button
              key={s}
              onClick={() => { setLoading(true); setFilterStatus(s); }}
              aria-pressed={filterStatus === s}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                filterStatus === s ? 'bg-solid text-inverse' : 'bg-raised text-muted hover:bg-line'
              }`}
            >
              {s === '' ? 'All status' : STATUS_LABELS[s]}
            </button>
          ))}
          <span className="ml-auto text-xs text-faint">
            {total} ticket{total !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['', 'feedback', 'billing', 'technical', 'feature_request', 'account', 'other'] as const).map(
            (t) => (
              <button
                key={t}
                onClick={() => { setLoading(true); setFilterType(t); }}
                aria-pressed={filterType === t}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  filterType === t ? 'bg-solid text-inverse' : 'bg-raised text-muted hover:bg-line'
                }`}
              >
                {t === '' ? 'All types' : TICKET_TYPE_LABELS[t]}
              </button>
            )
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-faint" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-10 text-center text-faint">
          <Inbox className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">No tickets found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <div key={t.id} className="overflow-hidden rounded-xl border border-line bg-surface">
              <button
                className="flex w-full items-start gap-3 p-5 text-left"
                onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                aria-expanded={expanded === t.id}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill className={PRIORITY_COLORS[t.priority] ?? 'bg-raised text-muted'}>
                      {PRIORITY_LABELS[t.priority] ?? `P${t.priority}`}
                    </Pill>
                    <span className="truncate text-sm font-medium text-ink">{t.subject}</span>
                    <Pill className={TICKET_TYPE_COLORS[t.ticket_type] ?? 'bg-raised text-muted'}>
                      {TICKET_TYPE_LABELS[t.ticket_type] ?? t.ticket_type}
                    </Pill>
                    <Pill className={STATUS_COLORS[t.status]}>{STATUS_LABELS[t.status]}</Pill>
                  </div>
                  <p className="mt-0.5 text-xs text-faint">
                    {t.email} &middot; {fmt(t.created_at)}
                  </p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-faint transition-transform ${
                    expanded === t.id ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {expanded === t.id && (
                <div className="space-y-4 border-t border-line px-5 pt-4 pb-5">
                  <p className="text-sm whitespace-pre-wrap text-muted">{t.message}</p>

                  {t.admin_notes && (
                    <div className="rounded-md border border-line bg-raised p-3">
                      <p className="mb-1 text-xs font-medium text-faint">Admin notes</p>
                      <p className="text-sm whitespace-pre-wrap text-muted">{t.admin_notes}</p>
                    </div>
                  )}

                  {canEdit ? (
                    <div className="space-y-2">
                      <textarea
                        rows={2}
                        placeholder="Add admin notes..."
                        value={notes[t.id] ?? t.admin_notes ?? ''}
                        onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })}
                        className="w-full resize-none rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink transition placeholder:text-faint focus:border-faint focus:ring-1 focus:ring-faint focus:outline-none"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        {(['open', 'in_progress', 'resolved', 'closed'] as const).map((s) => (
                          <button
                            key={s}
                            disabled={t.status === s || updating === t.id}
                            onClick={() =>
                              updateTicket(t.id, {
                                status: s,
                                admin_notes: notes[t.id] ?? t.admin_notes ?? undefined,
                              })
                            }
                            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${STATUS_COLORS[s]}`}
                          >
                            {updating === t.id ? (
                              <Loader2 className="inline h-3 w-3 animate-spin" />
                            ) : (
                              STATUS_LABELS[s]
                            )}
                          </button>
                        ))}
                        {notes[t.id] !== undefined && notes[t.id] !== (t.admin_notes ?? '') && (
                          <button
                            disabled={updating === t.id}
                            onClick={() => updateTicket(t.id, { admin_notes: notes[t.id] })}
                            className="rounded-full bg-ink/10 px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-ink/20 disabled:opacity-40"
                          >
                            Save notes
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-faint italic">
                      View only - contact an admin to update this ticket.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

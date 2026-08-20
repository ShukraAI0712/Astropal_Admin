'use client';

import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  FileText,
  Inbox,
  LogOut,
  Loader2,
  RefreshCw,
  Ticket as TicketIcon,
  Users,
  XCircle,
} from 'lucide-react';
import { RequireAuth } from '@/components/RequireAuth';
import { apiFetch, ApiError } from '@/lib/api.client';
import { supabase } from '@/lib/supabase.client';
import { ThemeToggle } from '@/components/ThemeToggle';

// ------------------------------------------------------------------ //
//  Types                                                               //
// ------------------------------------------------------------------ //

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
  1: 'bg-red-100 text-red-700 font-semibold dark:bg-red-500/15 dark:text-red-400',
  2: 'bg-amber-100 text-amber-700 font-medium dark:bg-amber-500/15 dark:text-amber-400',
  3: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  4: 'bg-raised text-muted',
};

interface ReportTypeStat {
  total: number;
  last_30_days: number;
  today?: number;
}

interface NewUserEntry {
  user_id: string;
  email: string | null;
  created_at: string | null;
}

interface TopFriendEntry {
  user_id: string;
  email: string | null;
  friend_count: number;
}

interface QueueFailure {
  report_type: string;
  last_error: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
}

type AppRole = 'super_admin' | 'admin' | 'staff' | 'user';

interface AdminStats {
  caller_role: AppRole;
  tickets: {
    open: number;
    in_progress: number;
    resolved: number;
    closed: number;
    total: number;
  };
  reports: {
    by_type: Record<string, ReportTypeStat>;
    total: number;
    last_30_days: number;
    today?: number;
    queue: { pending: number; failed: number; recent_failures?: QueueFailure[] };
  };
  users: {
    total: number;
    new_today?: number;
    new_today_users?: NewUserEntry[];
    top_friends?: TopFriendEntry[];
    by_plan: Record<string, number>;
  };
}

const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  staff: 'Staff',
  user: 'User',
};

const ROLE_COLORS: Record<AppRole, string> = {
  super_admin: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  admin: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  staff: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  user: 'bg-raised text-muted',
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

const REPORT_LABELS: Record<string, string> = {
  career: 'Career',
  relationship: 'Relationship',
  wealth: 'Wealth',
  vedic_health: 'Vedic Health',
  life_numerology: 'Numerology',
  marriage_life: 'Marriage Life',
  compatibility: 'Compatibility',
  baby_name: 'Baby Name',
  baby_name_vedic: 'Baby Name (Vedic)',
  baby_name_sikh: 'Baby Name (Sikh)',
};

function fmt(ts: string) {
  return new Date(ts).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ------------------------------------------------------------------ //
//  Shared bits                                                        //
// ------------------------------------------------------------------ //

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <p className="text-xs text-faint font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-faint">{sub}</p>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface overflow-hidden">
      <div className="px-5 py-4 border-b border-line">
        <p className="text-sm font-semibold text-ink">{title}</p>
      </div>
      {children}
    </div>
  );
}

function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${className}`}>
      {children}
    </span>
  );
}

// ------------------------------------------------------------------ //
//  Tickets tab                                                        //
// ------------------------------------------------------------------ //

function TicketsTab({ callerRole }: { callerRole: AppRole }) {
  const canEdit = callerRole !== 'user';

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterType) params.set('ticket_type', filterType);
      const qs = params.toString() ? `?${params}` : '';
      const data = await apiFetch<{ tickets: Ticket[]; total: number }>(
        `/support/admin/tickets${qs}`
      );
      setTickets(data.tickets);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
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
      await load();
    } finally {
      setUpdating(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {['', 'open', 'in_progress', 'resolved', 'closed'].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filterStatus === s
                ? 'bg-solid text-inverse'
                : 'bg-raised text-muted hover:bg-line'
            }`}
          >
            {s === '' ? 'All status' : STATUS_LABELS[s]}
          </button>
        ))}
        <span className="ml-auto text-xs text-faint">{total} ticket{total !== 1 ? 's' : ''}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {(['', 'feedback', 'billing', 'technical', 'feature_request', 'account', 'other'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              filterType === t
                ? 'bg-solid text-inverse'
                : 'bg-raised text-muted hover:bg-line'
            }`}
          >
            {t === '' ? 'All types' : TICKET_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-faint" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface p-10 text-center text-faint">
          <Inbox className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No tickets found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <div key={t.id} className="rounded-lg border border-line bg-surface overflow-hidden">
              <button
                className="w-full text-left p-5 flex items-start gap-3"
                onClick={() => setExpanded(expanded === t.id ? null : t.id)}
              >
                <TicketIcon className="h-4 w-4 mt-0.5 shrink-0 text-faint" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Pill className={PRIORITY_COLORS[t.priority] ?? 'bg-raised text-muted'}>
                      {PRIORITY_LABELS[t.priority] ?? `P${t.priority}`}
                    </Pill>
                    <span className="font-medium text-ink text-sm truncate">{t.subject}</span>
                    <Pill className={TICKET_TYPE_COLORS[t.ticket_type] ?? 'bg-raised text-muted'}>
                      {TICKET_TYPE_LABELS[t.ticket_type] ?? t.ticket_type}
                    </Pill>
                    <Pill className={STATUS_COLORS[t.status]}>{STATUS_LABELS[t.status]}</Pill>
                  </div>
                  <p className="text-xs text-faint mt-0.5">
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
                <div className="border-t border-line px-5 pb-5 pt-4 space-y-4">
                  <p className="text-sm text-muted whitespace-pre-wrap">{t.message}</p>

                  {t.admin_notes && (
                    <div className="rounded-md bg-raised border border-line p-3">
                      <p className="text-xs font-medium text-faint mb-1">Admin notes</p>
                      <p className="text-sm text-muted whitespace-pre-wrap">{t.admin_notes}</p>
                    </div>
                  )}

                  {canEdit ? (
                    <div className="space-y-2">
                      <textarea
                        rows={2}
                        placeholder="Add admin notes..."
                        value={notes[t.id] ?? t.admin_notes ?? ''}
                        onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })}
                        className="w-full rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-faint focus:outline-none focus:ring-1 focus:ring-faint resize-none transition"
                      />
                      <div className="flex items-center gap-2 flex-wrap">
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
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${STATUS_COLORS[s]}`}
                          >
                            {updating === t.id ? (
                              <Loader2 className="h-3 w-3 animate-spin inline" />
                            ) : (
                              STATUS_LABELS[s]
                            )}
                          </button>
                        ))}
                        {notes[t.id] !== undefined && notes[t.id] !== (t.admin_notes ?? '') && (
                          <button
                            disabled={updating === t.id}
                            onClick={() => updateTicket(t.id, { admin_notes: notes[t.id] })}
                            className="px-3 py-1.5 rounded-full text-xs font-medium bg-ink/10 text-ink hover:bg-ink/20 transition-colors disabled:opacity-40"
                          >
                            Save notes
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-faint italic">View only - contact an admin to update this ticket.</p>
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

// ------------------------------------------------------------------ //
//  Reports tab                                                        //
// ------------------------------------------------------------------ //

function ReportsTab({ stats }: { stats: AdminStats }) {
  const { by_type, total, last_30_days, today, queue } = stats.reports;
  const failures = queue.recent_failures ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="Today" value={today ?? 0} />
        <StatCard label="Last 30 days" value={last_30_days} />
        <StatCard label="Total reports" value={total} />
        <StatCard label="Queue pending" value={queue.pending} />
        <StatCard label="Queue failed" value={queue.failed} />
      </div>

      <Panel title="Recent failures">
        {failures.length === 0 ? (
          <p className="px-5 py-6 text-sm text-faint">No failed report jobs. All clear.</p>
        ) : (
          <div className="divide-y divide-line">
            {failures.map((f, i) => (
              <div key={i} className="px-5 py-3.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Pill className="bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400">
                    {REPORT_LABELS[f.report_type] ?? f.report_type}
                  </Pill>
                  <span className="text-xs text-faint">
                    {fmt(f.updated_at)} &middot; attempt {f.attempt_count}
                  </span>
                </div>
                {f.last_error && (
                  <p className="mt-1.5 text-xs text-faint break-words line-clamp-2">
                    {f.last_error}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Reports by type">
        <div className="divide-y divide-line">
          {Object.entries(by_type).map(([key, val]) => (
            <div key={key} className="flex items-center justify-between px-5 py-3.5">
              <p className="text-sm font-medium text-ink">{REPORT_LABELS[key] ?? key}</p>
              <div className="flex items-center gap-6 text-right">
                <div>
                  <p className="text-sm font-semibold text-ink">{val.today ?? 0}</p>
                  <p className="text-xs text-faint">today</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">{val.last_30_days}</p>
                  <p className="text-xs text-faint">30d</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">{val.total}</p>
                  <p className="text-xs text-faint">total</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ //
//  Users tab                                                          //
// ------------------------------------------------------------------ //

function UsersTab({ stats }: { stats: AdminStats }) {
  const { total, new_today, new_today_users, top_friends, by_plan } = stats.users;
  const planOrder = ['basic', 'pro', 'ultra'];
  const newUsers = new_today_users ?? [];
  const topFriends = top_friends ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="New today" value={new_today ?? 0} />
        <StatCard label="Total users" value={total} sub="across all plans" />
      </div>

      <Panel title="New users today">
        {newUsers.length === 0 ? (
          <p className="px-5 py-6 text-sm text-faint">No new users yet today.</p>
        ) : (
          <div className="divide-y divide-line">
            {newUsers.map((u) => (
              <div key={u.user_id} className="flex items-center justify-between gap-3 px-5 py-3">
                <p className="text-sm text-ink truncate">
                  {u.email ?? <span className="text-faint">{u.user_id}</span>}
                </p>
                {u.created_at && <p className="text-xs text-faint shrink-0">{fmt(u.created_at)}</p>}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Most friends">
        {topFriends.length === 0 ? (
          <p className="px-5 py-6 text-sm text-faint">No accepted friendships yet.</p>
        ) : (
          <div className="divide-y divide-line">
            {topFriends.map((f, i) => (
              <div key={f.user_id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-semibold text-faint w-4 shrink-0">{i + 1}</span>
                  <p className="text-sm text-ink truncate">
                    {f.email ?? <span className="text-faint">{f.user_id}</span>}
                  </p>
                </div>
                <p className="text-sm font-semibold text-ink shrink-0">
                  {f.friend_count}
                  <span className="ml-1 text-xs font-normal text-faint">
                    friend{f.friend_count !== 1 ? 's' : ''}
                  </span>
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Users by plan">
        <div className="divide-y divide-line">
          {[...planOrder, ...Object.keys(by_plan).filter((p) => !planOrder.includes(p))].map((plan) => {
            const count = by_plan[plan] ?? 0;
            const pct = total ? Math.round((count / total) * 100) : 0;
            return (
              <div key={plan} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium capitalize text-ink">{plan}</span>
                  <span className="text-sm font-semibold text-ink">
                    {count} <span className="text-faint font-normal text-xs">({pct}%)</span>
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-raised overflow-hidden">
                  <div className="h-full rounded-full bg-ink/60" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ //
//  Main admin page                                                    //
// ------------------------------------------------------------------ //

type Tab = 'tickets' | 'reports' | 'users';

function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('tickets');

  const loadStats = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const data = await apiFetch<AdminStats>('/support/admin/stats');
      setStats(data);
      setUpdatedAt(new Date());
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setError('Your account does not have admin access.');
        return;
      }
      if (e instanceof ApiError && e.status === 404) {
        setError('Admin API not found (404). Check the backend deployment.');
        return;
      }
      setError(e instanceof Error ? e.message : 'Failed to load stats.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (refreshing && !stats) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-faint" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-4">
          <XCircle className="h-12 w-12 text-red-500 mx-auto" />
          <p className="text-muted text-sm">{error}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={loadStats}
              className="inline-flex items-center gap-2 rounded-md bg-solid text-inverse text-sm font-medium px-4 py-2 transition-colors hover:opacity-90"
            >
              <RefreshCw className="h-4 w-4" /> Retry
            </button>
            <button
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 rounded-md border border-line text-muted text-sm font-medium px-4 py-2 transition-colors hover:bg-raised"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'tickets', label: 'Support tickets', icon: <TicketIcon className="h-4 w-4" /> },
    { id: 'reports', label: 'Reports', icon: <FileText className="h-4 w-4" /> },
    { id: 'users', label: 'Users', icon: <Users className="h-4 w-4" /> },
  ];

  return (
    <div className="min-h-screen py-10 md:py-14">
      <div className="container mx-auto px-4 max-w-4xl space-y-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-xs font-medium uppercase tracking-wide text-faint">Internal</p>
              <Pill className={ROLE_COLORS[stats.caller_role]}>{ROLE_LABELS[stats.caller_role]}</Pill>
            </div>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-ink">
              AstroPal Admin
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {updatedAt && (
              <span className="text-xs text-faint">
                Updated {updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <ThemeToggle />
            <button
              onClick={loadStats}
              disabled={refreshing}
              title="Refresh"
              className="h-9 w-9 flex items-center justify-center rounded-md border border-line hover:bg-raised transition-colors text-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleSignOut}
              title="Sign out"
              className="h-9 w-9 flex items-center justify-center rounded-md border border-line hover:bg-raised transition-colors text-muted"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="New users today" value={stats.users.new_today ?? 0} sub={`${stats.users.total} all-time`} />
          <StatCard label="Reports today" value={stats.reports.today ?? 0} sub={`${stats.reports.last_30_days} in 30 days`} />
          <StatCard label="Failed reports" value={stats.reports.queue.failed} sub={`${stats.reports.queue.pending} pending in queue`} />
          <StatCard label="Open tickets" value={stats.tickets.open} sub={`${stats.tickets.total} total`} />
        </div>

        <div>
          <div className="flex gap-1 border-b border-line mb-6">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-ink text-ink'
                    : 'border-transparent text-faint hover:text-muted'
                }`}
              >
                {t.icon}
                {t.label}
                {t.id === 'tickets' && stats.tickets.open > 0 && (
                  <span className="ml-1 h-5 min-w-[1.25rem] rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                    {stats.tickets.open}
                  </span>
                )}
              </button>
            ))}
          </div>

          {tab === 'tickets' && <TicketsTab callerRole={stats.caller_role} />}
          {tab === 'reports' && <ReportsTab stats={stats} />}
          {tab === 'users' && <UsersTab stats={stats} />}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <RequireAuth>
      <AdminDashboard />
    </RequireAuth>
  );
}

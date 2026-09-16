'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Copy, Search, X } from 'lucide-react';
import { initial, name, type JourneyStage } from '@/lib/analytics';

/**
 * The primitives every panel in this dashboard is built from.
 *
 * They live here rather than inside a page so a second screen cannot quietly
 * grow its own slightly different card. There is one stat tile, one panel, one
 * pill, one table and one full-screen sheet in this app.
 */

export function Panel({
  title,
  subtitle,
  action,
  children,
  bare = false,
}: {
  title: string;
  /** One line under the title. Use it to say what the number actually counts. */
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  /** Skip the inner padding, for a panel whose body is a table or a list. */
  bare?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      {/* Stacks below `sm`: a header with a range picker in it has no room
          for a side-by-side title on a phone, and squeezing one produces a
          heading set one word per line. */}
      <header className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-faint">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className={bare ? '' : 'p-5'}>{children}</div>
    </section>
  );
}

export function Pill({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * A headline number with the thing it should be compared against.
 *
 * `delta` is a percentage against a NAMED period, never a bare arrow: "+12% vs
 * last week" is a fact and "up" is not. When the comparison period was zero
 * the delta is omitted rather than rendered as +100%, because growth from
 * nothing is not a growth rate.
 *
 * `goodWhenUp` exists because direction is not the same as good. More failed
 * payments is a rise and a problem, so the colour follows the meaning.
 */
export function StatCard({
  label,
  value,
  sub,
  delta,
  deltaLabel,
  goodWhenUp = true,
  trend,
  tone,
  onOpen,
  openLabel,
}: {
  label: string;
  value: string | number;
  sub?: string;
  delta?: number | null;
  deltaLabel?: string;
  goodWhenUp?: boolean;
  trend?: ReactNode;
  /** Paints the value when the number itself is a state, not a quantity. */
  tone?: 'good' | 'warning' | 'critical';
  /**
   * Makes the whole tile a button that opens the list the number counts.
   *
   * A tile without this stays a plain div rather than a button with nothing
   * behind it: a card that looks tappable and does nothing is worse than one
   * that never claimed to be.
   */
  onOpen?: () => void;
  /** Screen-reader wording for the button, e.g. "See who is active today". */
  openLabel?: string;
}) {
  const good = delta !== null && delta !== undefined && (delta >= 0) === goodWhenUp;

  const toneClass =
    tone === 'critical'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'good'
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-ink';

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-faint uppercase">{label}</p>
        {onOpen && (
          <ChevronRight
            aria-hidden
            className="mt-px h-3.5 w-3.5 shrink-0 text-faint transition-transform group-hover:translate-x-0.5"
          />
        )}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
        {trend}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
        {delta !== null && delta !== undefined && (
          <span
            className={`font-medium ${
              good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
            }`}
          >
            {delta >= 0 ? '+' : ''}
            {delta}%
            {deltaLabel && <span className="ml-1 font-normal text-faint">{deltaLabel}</span>}
          </span>
        )}
        {sub && <span className="text-faint">{sub}</span>}
      </div>
    </>
  );

  if (!onOpen) {
    return <div className="rounded-xl border border-line bg-surface p-4">{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={openLabel ?? `${label}: open the list`}
      className="group rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-faint hover:bg-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      style={{ outlineColor: 'var(--ink)' }}
    >
      {body}
    </button>
  );
}

/** A plain data table. One border style, one alignment rule: numbers right. */
export function Table({
  head,
  children,
  minWidth = 520,
}: {
  head: { label: string; align?: 'left' | 'right' }[];
  children: ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-line">
            {head.map((h) => (
              <th
                key={h.label}
                className={`px-5 py-2.5 text-xs font-medium text-faint ${
                  h.align === 'right' ? 'text-right' : 'text-left'
                }`}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({
  children,
  align = 'left',
  muted = false,
  className = '',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  muted?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-5 py-2.5 ${align === 'right' ? 'text-right tabular-nums' : ''} ${
        muted ? 'text-muted' : 'text-ink'
      } ${className}`}
    >
      {children}
    </td>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-faint">{children}</p>;
}

/**
 * A note about what a number does NOT include.
 *
 * Used wherever the honest answer is narrower than the question - the
 * categories that only cover sessions the astrologer remembered something
 * from, the sign-in count that is not an app-open count. A dashboard that
 * hides its own footnotes is how people end up acting on a number that never
 * meant what they read.
 */
export function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-line bg-raised px-3 py-2 text-xs leading-relaxed text-muted">
      {children}
    </p>
  );
}

/** "20 Sep 2026, 11:30" - the one date-time format in this dashboard. */
export function fmt(ts: string | null | undefined) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "20 Sep 2026" - dates without a time, for coupon windows. */
export function fmtDate(ts: string | null | undefined) {
  if (!ts) return '-';
  return new Date(ts).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const PLAN_COLORS: Record<string, string> = {
  basic: 'bg-raised text-muted',
  pro: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  ultra: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
};

/**
 * The stage swatch, in journey order.
 *
 * Sequential rather than categorical, because the stages are one thing more or
 * less of - further along the same path - and a rainbow would imply they were
 * six unrelated kinds of person.
 */
export const STAGE_COLORS: Record<JourneyStage, string> = {
  'Only signed up': 'bg-raised text-muted',
  'Made a horoscope': 'bg-stone-200 text-stone-700 dark:bg-stone-500/20 dark:text-stone-300',
  'Asked 1-5': 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  'Asked more than 5': 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  'Came back after 5+': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  Paying: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
};

export function StagePill({ stage }: { stage: JourneyStage | null | undefined }) {
  if (!stage) return null;
  return <Pill className={STAGE_COLORS[stage] ?? PLAN_COLORS.basic}>{stage}</Pill>;
}

// ------------------------------------------------------------------ //
//  People                                                             //
// ------------------------------------------------------------------ //

/**
 * The initial chip that carries a person's identity in a list.
 *
 * Its colour is derived from the user id rather than assigned, so the same
 * person is the same colour on every screen without anything having to store
 * that. Eight hues, the chart palette, at a wash the ink still clears.
 */
export function Avatar({
  person,
  live = false,
}: {
  person: { first_name?: string | null; email?: string | null; user_id: string };
  /** Draws the presence dot. Only the live list sets it. */
  live?: boolean;
}) {
  let h = 0;
  for (const c of person.user_id) h = (h * 31 + c.charCodeAt(0)) % 8;
  const color = `var(--series-${h + 1})`;

  return (
    <span className="relative inline-flex shrink-0">
      <span
        aria-hidden
        className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
        style={{ background: `color-mix(in srgb, ${color} 18%, var(--surface))`, color: 'var(--ink)' }}
      >
        {initial(person)}
      </span>
      {live && (
        <span
          aria-hidden
          className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2"
          style={{ background: 'var(--status-good)', borderColor: 'var(--surface)' }}
        />
      )}
    </span>
  );
}

/**
 * Copies a list of email addresses to the clipboard.
 *
 * Shared rather than per-screen, because every list of people in this app ends
 * with the same question: who do I mail about this.
 */
export function CopyEmails({ emails, label = 'emails' }: { emails: (string | null)[]; label?: string }) {
  const [copied, setCopied] = useState(false);
  const usable = useMemo(() => emails.filter((e): e is string => Boolean(e)), [emails]);

  if (usable.length === 0) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(usable.join(', '));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-raised"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : `Copy ${usable.length} ${label}`}
    </button>
  );
}

/**
 * One person in a list: avatar, name, email, and whatever the list is about.
 *
 * The name leads and the email is secondary, which is the whole point of
 * resolving names in SQL - "Nitika asked 3 questions" is a sentence and
 * "nitika.eecm@gmail.com asked 3 questions" is a log line.
 */
export function PersonRow({
  person,
  live = false,
  meta,
  right,
}: {
  person: { first_name?: string | null; full_name?: string | null; email?: string | null; user_id: string };
  live?: boolean;
  /** The line under the name. Falls back to the email. */
  meta?: ReactNode;
  right?: ReactNode;
}) {
  return (
    // Wraps rather than squeezes. On a phone a name, a "3 min ago" and two
    // pills do not fit on one line, and the loser was always the timestamp -
    // truncated to "3 min", which is not a smaller version of the fact but a
    // different one. Below the breakpoint the right-hand block drops to its
    // own line instead.
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
      <Avatar person={person} live={live} />
      <div className="min-w-[9rem] flex-1 basis-0">
        <p className="truncate text-sm font-medium text-ink">
          {person.full_name || name(person)}
        </p>
        <p className="truncate text-xs text-faint">{meta ?? person.email ?? person.user_id.slice(0, 8)}</p>
      </div>
      {right && <div className="ml-auto flex shrink-0 items-center gap-2 text-right">{right}</div>}
    </li>
  );
}

// ------------------------------------------------------------------ //
//  Full-screen sheet                                                  //
// ------------------------------------------------------------------ //

/**
 * The list behind a number, over the whole screen.
 *
 * A tile answers "how many" and this answers "who", and the second question is
 * the one you act on. It is full-screen rather than a small modal because the
 * content is a list of people that has to stay readable on the phone this
 * dashboard is mostly read on - a centred dialog would give it a third of the
 * viewport and a scrollbar.
 *
 * Escape closes it, the backdrop closes it, and the page behind it does not
 * scroll while it is open.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  action,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="absolute inset-0 flex flex-col bg-canvas sm:inset-4 sm:rounded-2xl sm:border sm:border-line sm:shadow-2xl">
        <header className="flex items-start gap-3 border-b border-line bg-surface px-5 py-4 sm:rounded-t-2xl">
          {/* The title wraps rather than truncating. It carries a count in
              brackets, and "Asked something toda..." loses the number that
              made the sheet worth opening. */}
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-balance text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-raised"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto w-full max-w-3xl pb-10">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * A type-to-filter box for a sheet whose list is long enough to need one.
 *
 * Below `min` rows it renders nothing: a search box over eleven names is
 * furniture, and the eye is faster than the keyboard at that size.
 */
export function Filter({
  value,
  onChange,
  count,
  min = 12,
  placeholder = 'Filter by name or email',
}: {
  value: string;
  onChange: (v: string) => void;
  count: number;
  min?: number;
  placeholder?: string;
}) {
  if (count < min) return null;
  return (
    <div className="relative px-5 pt-4">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-8 h-4 w-4 -translate-y-1/2 text-faint" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-lg border border-line bg-surface py-2 pr-3 pl-9 text-sm text-ink placeholder:text-faint focus:border-faint focus:outline-none"
      />
    </div>
  );
}

import type { ReactNode } from 'react';

/**
 * The primitives every panel in this dashboard is built from.
 *
 * They live here rather than inside a page so a second screen cannot quietly
 * grow its own slightly different card. There is one stat tile, one panel, one
 * pill and one table in this app.
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

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium tracking-wide text-faint uppercase">{label}</p>
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
    </div>
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

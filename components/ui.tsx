import type { ReactNode } from 'react';

/**
 * The three primitives every panel in this dashboard is built from, and
 * the one date format it uses.
 *
 * They live here rather than inside a page so a second screen cannot
 * quietly grow its own slightly different card. There is one stat tile,
 * one panel and one pill in this app.
 */

export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <p className="text-xs text-faint font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-faint">{sub}</p>}
    </div>
  );
}

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  /** Optional control in the panel header, e.g. a New button. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface overflow-hidden">
      <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">{title}</p>
        {action}
      </div>
      {children}
    </div>
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
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs ${className}`}>
      {children}
    </span>
  );
}

/** "20 Sep 2026, 11:30" - the one date format in this dashboard. */
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

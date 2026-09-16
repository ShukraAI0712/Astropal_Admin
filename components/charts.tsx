'use client';

import {
  useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode,
} from 'react';
import type { Range } from '@/lib/analytics';

/**
 * Every chart in this dashboard, built from plain SVG.
 *
 * There is no charting library here on purpose: the whole visual vocabulary is
 * four forms, and four hand-written forms are smaller, themeable from the same
 * CSS variables as the rest of the app, and free of a second set of colour
 * decisions that would have to be kept honest separately.
 *
 * The rules these share, and none of them is cosmetic:
 *
 *   * Colour comes from `--series-1..8` in globals.css, assigned in fixed
 *     order and never cycled. A ninth series does not get a new colour; it
 *     folds into Other.
 *   * Two-pixel lines, hairline solid gridlines, bars capped at 24px with a
 *     rounded data-end, a 2px surface gap between touching marks, and a 2px
 *     surface ring on every marker so it stays legible where lines cross.
 *   * Text never wears the data colour. Values, labels and legends use the
 *     ink tokens; identity comes from the coloured swatch beside them. Three
 *     of the eight light-mode slots sit below 3:1 on white, so a number
 *     painted in one would be unreadable.
 *   * A legend for two or more series, always. One series needs none - the
 *     title says what is plotted.
 *   * Hover is part of the chart, not an extra: a crosshair and a tooltip on
 *     the time series, a per-mark tooltip on the bars.
 */

export const SERIES = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
] as const;

export const SEQ = [
  'var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)',
  'var(--seq-4)', 'var(--seq-5)', 'var(--seq-6)',
] as const;

export const STATUS = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  serious: 'var(--status-serious)',
  critical: 'var(--status-critical)',
} as const;

/**
 * useLayoutEffect warns when React renders on the server, and these charts are
 * server-rendered before they hydrate. Same hook, no warning.
 */
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** Measures the element so the SVG can be drawn at real pixel width. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}

/**
 * Axis ticks rounded to clean numbers, always reaching AT OR ABOVE the
 * largest value.
 *
 * The top tick is what the plot scales against, so a tick list that stops
 * short of the data does not merely lose a gridline - every value above it
 * lands at a negative y and paints outside the SVG, across the legend and the
 * panel header. Ending the loop one step past `max` is the whole fix, and the
 * integer floor on the step keeps a chart whose maximum is 1 or 2 from
 * producing a list of duplicate rounded ticks.
 */
function ticks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const candidate = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
  const step = Math.max(1, candidate);
  const out: number[] = [];
  for (let v = 0; v < max + step; v += step) out.push(Math.round(v));
  return [...new Set(out)];
}

function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

// ------------------------------------------------------------------ //
//  Legend                                                             //
// ------------------------------------------------------------------ //

export function Legend({
  items,
}: {
  items: { label: string; color: string; value?: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: it.color }}
          />
          {it.label}
          {it.value !== undefined && (
            <span className="font-medium text-ink tabular-nums">{it.value}</span>
          )}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ //
//  Time series                                                        //
// ------------------------------------------------------------------ //

export interface Line {
  key: string;
  label: string;
  values: number[];
  color: string;
  /** Renders the value in the tooltip, e.g. rupees from paise. */
  format?: (n: number) => string;
}

/**
 * One or more lines against one y-axis.
 *
 * Deliberately never a second y-axis. Two measures on different scales get two
 * charts or an index to a common base - a dual axis lets the author choose
 * where the lines cross, which is a claim the data did not make.
 */
export function TimeSeries({
  labels,
  lines,
  height = 200,
  area = false,
}: {
  labels: string[];
  lines: Line[];
  height?: number;
  /** A single-series chart may carry a 10% wash under the line. */
  area?: boolean;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const padL = 40;
  const padR = 12;
  const padT = 10;
  const padB = 22;
  const w = Math.max(width, 240);
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;

  const max = Math.max(1, ...lines.flatMap((l) => l.values));
  const yt = ticks(max);
  const top = yt[yt.length - 1];

  const x = (i: number) =>
    padL + (labels.length <= 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / top) * innerH;

  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const px = e.clientX - rect.left;
      if (labels.length < 2) return setHover(0);
      const i = Math.round(((px - padL) / innerW) * (labels.length - 1));
      setHover(Math.min(labels.length - 1, Math.max(0, i)));
    },
    [labels.length, innerW]
  );

  // Ticks are thinned so they never collide, whatever the container width.
  const every = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(innerW / 64))));

  return (
    <div ref={ref} className="relative w-full">
      {lines.length > 1 && (
        <div className="mb-3">
          <Legend items={lines.map((l) => ({ label: l.label, color: l.color }))} />
        </div>
      )}

      <svg
        width={w}
        height={height}
        role="img"
        aria-label={lines.map((l) => l.label).join(', ')}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        className="overflow-visible"
      >
        {yt.map((t) => (
          <g key={t}>
            <line
              x1={padL} x2={w - padR} y1={y(t)} y2={y(t)}
              stroke="var(--grid)" strokeWidth={1}
            />
            <text
              x={padL - 8} y={y(t) + 3} textAnchor="end"
              className="fill-faint" style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
            >
              {compact(t)}
            </text>
          </g>
        ))}

        {labels.map((lab, i) =>
          i % every === 0 || i === labels.length - 1 ? (
            <text
              key={lab + i} x={x(i)} y={height - 6} textAnchor="middle"
              className="fill-faint" style={{ fontSize: 10 }}
            >
              {lab}
            </text>
          ) : null
        )}

        {area && lines.length === 1 && (
          <path
            d={
              `M ${x(0)} ${y(0)} ` +
              lines[0].values.map((v, i) => `L ${x(i)} ${y(v)}`).join(' ') +
              ` L ${x(labels.length - 1)} ${y(0)} Z`
            }
            fill={lines[0].color}
            opacity={0.1}
          />
        )}

        {lines.map((l) => (
          <path
            key={l.key}
            d={l.values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ')}
            fill="none"
            stroke={l.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* The end marker: the one point every line gets, ringed in the
            surface colour so overlapping ends stay separate. */}
        {lines.map((l) => (
          <circle
            key={`${l.key}-end`}
            cx={x(labels.length - 1)}
            cy={y(l.values[l.values.length - 1] ?? 0)}
            r={4}
            fill={l.color}
            stroke="var(--surface)"
            strokeWidth={2}
          />
        ))}

        {hover !== null && (
          <>
            <line
              x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH}
              stroke="var(--axis)" strokeWidth={1}
            />
            {lines.map((l) => (
              <circle
                key={`${l.key}-hv`}
                cx={x(hover)} cy={y(l.values[hover] ?? 0)} r={4}
                fill={l.color} stroke="var(--surface)" strokeWidth={2}
              />
            ))}
          </>
        )}
      </svg>

      {hover !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-line bg-surface px-3 py-2 shadow-lg"
          style={{
            left: Math.min(Math.max(x(hover) - 60, 0), Math.max(w - 150, 0)),
            top: 0,
          }}
        >
          <p className="mb-1 text-xs font-medium text-ink">{labels[hover]}</p>
          {lines.map((l) => (
            <p key={l.key} className="flex items-center gap-1.5 text-xs text-muted">
              <span
                aria-hidden className="h-2 w-2 rounded-full"
                style={{ background: l.color }}
              />
              {l.label}
              <span className="ml-auto pl-3 font-medium text-ink tabular-nums">
                {l.format ? l.format(l.values[hover] ?? 0) : (l.values[hover] ?? 0).toLocaleString('en-IN')}
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ //
//  Bar list                                                           //
// ------------------------------------------------------------------ //

/**
 * Ranked magnitudes, one bar per row, value at the tip.
 *
 * A bar list rather than a pie: comparing lengths against a shared baseline is
 * the thing people are accurate at, and a pie of eleven report types is not
 * readable at any size.
 */
export function BarList({
  rows,
  color = 'var(--series-1)',
  format = (n: number) => n.toLocaleString('en-IN'),
  max: forcedMax,
}: {
  rows: { label: string; value: number; sub?: string; color?: string }[];
  color?: string;
  format?: (n: number) => string;
  max?: number;
}) {
  const max = forcedMax ?? Math.max(1, ...rows.map((r) => r.value));

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-faint">Nothing recorded yet.</p>;
  }

  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-sm text-ink">{r.label}</span>
            <span className="shrink-0 text-sm font-medium text-ink tabular-nums">
              {format(r.value)}
              {r.sub && <span className="ml-1.5 text-xs font-normal text-faint">{r.sub}</span>}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-r-[4px] transition-[width] duration-500"
              style={{
                width: `${Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0)}%`,
                background: r.color ?? color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ //
//  Stacked bar                                                        //
// ------------------------------------------------------------------ //

/** One row, parts of a whole, with a 2px surface gap between segments. */
export function StackedBar({
  parts,
  format = (n: number) => n.toLocaleString('en-IN'),
}: {
  parts: { label: string; value: number; color: string }[];
  format?: (n: number) => string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0);

  if (total === 0) {
    return <p className="py-6 text-center text-sm text-faint">Nothing recorded yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-raised">
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div
              key={p.label}
              style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
              className="first:rounded-l-full last:rounded-r-full"
            />
          ))}
      </div>
      <Legend
        items={parts.map((p) => ({
          label: p.label,
          color: p.color,
          value: `${format(p.value)} (${Math.round((p.value / total) * 100)}%)`,
        }))}
      />
    </div>
  );
}

// ------------------------------------------------------------------ //
//  Funnel                                                             //
// ------------------------------------------------------------------ //

export interface FunnelStep {
  key: string;
  label: string;
  value: number;
  /** What this step actually counts, in one line. */
  hint?: string;
}

/**
 * A journey funnel: one bar per step, every bar measured against the first.
 *
 * Deliberately NOT the tapering trapezoid that funnel charts usually are. A
 * trapezoid encodes each step as an area, and area is the thing people read
 * least accurately - a step that kept 40% of the previous one looks like it
 * kept about two thirds. These are bars against a shared left baseline, which
 * is the comparison the eye is actually good at.
 *
 * Two numbers ride on every step, and they answer different questions:
 * the share of the ORIGINAL cohort (how big is this group), and the share of
 * the PREVIOUS step (how well did this step convert). A funnel that shows only
 * the first hides the step that is leaking; one that shows only the second
 * hides how little is left by the end.
 */
export function Funnel({
  steps,
  color = 'var(--series-1)',
}: {
  steps: FunnelStep[];
  color?: string;
}) {
  const top = steps[0]?.value ?? 0;

  if (!top) {
    return <p className="py-6 text-center text-sm text-faint">Nobody in this cohort yet.</p>;
  }

  return (
    <ol className="space-y-1">
      {steps.map((s, i) => {
        const prev = i === 0 ? null : steps[i - 1].value;
        const ofTop = Math.round((s.value / top) * 100);
        const ofPrev = prev ? Math.round((s.value / prev) * 100) : null;
        const lost = prev === null ? 0 : prev - s.value;

        return (
          <li key={s.key}>
            {/* The drop sits BETWEEN two bars rather than on one of them,
                because it is a fact about the gap and not about either step. */}
            {prev !== null && (
              <div className="flex items-center gap-2 py-1 pl-1">
                <span aria-hidden className="h-4 w-px" style={{ background: 'var(--line)' }} />
                <span className="text-[11px] text-faint">
                  {lost > 0 ? (
                    <>
                      <span style={{ color: 'var(--status-serious)' }}>
                        −{lost.toLocaleString('en-IN')}
                      </span>{' '}
                      dropped here
                    </>
                  ) : (
                    'nobody lost here'
                  )}
                </span>
              </div>
            )}

            {/* The label gets the line and the count, and the two percentages
                go underneath. Sharing one line truncated the step name on a
                phone - "2. Made a horos..." - and the name is the part you
                cannot infer from the others. */}
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-sm text-ink">
                {i + 1}. {s.label}
              </span>
              <span className="shrink-0 text-sm font-medium text-ink tabular-nums">
                {s.value.toLocaleString('en-IN')}
              </span>
            </div>

            <div className="h-3 w-full overflow-hidden rounded-full bg-raised">
              <div
                className="h-full rounded-r-[6px] transition-[width] duration-500"
                style={{
                  width: `${Math.max(ofTop, s.value > 0 ? 1.5 : 0)}%`,
                  background: color,
                }}
              />
            </div>

            <p className="mt-1 text-[11px] text-faint">
              {ofTop}% of everyone
              {ofPrev !== null && ` · ${ofPrev}% of the step above`}
              {s.hint && ` · ${s.hint}`}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

// ------------------------------------------------------------------ //
//  Sparkline                                                          //
// ------------------------------------------------------------------ //

/** The twelve-point trend that rides inside a stat tile. */
export function Sparkline({
  values,
  color = 'var(--series-1)',
  width = 88,
  height = 26,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => height - 3 - (v / max) * (height - 6);

  return (
    <svg width={width} height={height} aria-hidden className="shrink-0">
      <path
        d={values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ')}
        fill="none" stroke={color} strokeWidth={2}
        strokeLinecap="round" strokeLinejoin="round"
      />
      <circle
        cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.5}
        fill={color} stroke="var(--surface)" strokeWidth={2}
      />
    </svg>
  );
}

// ------------------------------------------------------------------ //
//  Cohort grid                                                        //
// ------------------------------------------------------------------ //

/**
 * Retention as a heatmap: one row per signup week, one cell per week since.
 *
 * Sequential encoding, so it is one hue light to dark and never a rainbow -
 * the cell means "more or less of the same thing", not "a different thing".
 * Every cell carries its percentage as text, so the colour is a second reading
 * of a number that is already legible.
 */
export function CohortGrid({
  rows,
}: {
  rows: { week: string; size: number; w1: number; w2: number; w3: number; w4: number }[];
}) {
  const [hover, setHover] = useState<string | null>(null);

  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-faint">No cohorts yet.</p>;
  }

  const shade = (pct: number) => {
    if (pct <= 0) return 'var(--raised)';
    if (pct < 5) return SEQ[0];
    if (pct < 10) return SEQ[1];
    if (pct < 20) return SEQ[2];
    if (pct < 35) return SEQ[3];
    if (pct < 50) return SEQ[4];
    return SEQ[5];
  };

  // Above 20% the fill is dark enough that ink would not clear contrast.
  const ink = (pct: number) => (pct >= 20 ? '#ffffff' : 'var(--ink)');

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-separate border-spacing-[2px] text-xs">
        <thead>
          <tr className="text-faint">
            <th className="px-2 py-1 text-left font-medium">Signed up</th>
            <th className="px-2 py-1 text-right font-medium">Size</th>
            {['Week 1', 'Week 2', 'Week 3', 'Week 4'].map((h) => (
              <th key={h} className="px-2 py-1 text-center font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cells = [r.w1, r.w2, r.w3, r.w4];
            return (
              <tr key={r.week}>
                <td className="whitespace-nowrap px-2 py-1 text-muted">
                  {new Date(r.week).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </td>
                <td className="px-2 py-1 text-right font-medium text-ink tabular-nums">{r.size}</td>
                {cells.map((c, i) => {
                  const pct = r.size ? Math.round((c / r.size) * 100) : 0;
                  const id = `${r.week}-${i}`;
                  return (
                    <td
                      key={id}
                      onMouseEnter={() => setHover(id)}
                      onMouseLeave={() => setHover(null)}
                      title={`${c} of ${r.size} still active in week ${i + 1}`}
                      className="relative rounded px-2 py-1 text-center tabular-nums"
                      style={{
                        background: shade(pct),
                        color: ink(pct),
                        outline: hover === id ? '2px solid var(--ink)' : 'none',
                      }}
                    >
                      {pct ? `${pct}%` : '-'}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ //
//  Range picker                                                       //
// ------------------------------------------------------------------ //



export const RANGES: { id: Range; label: string }[] = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: '6m', label: '6 months' },
  { id: '1y', label: '1 year' },
];

export function RangeTabs({
  value,
  onChange,
  children,
}: {
  value: Range;
  onChange: (r: Range) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => onChange(r.id)}
            aria-pressed={value === r.id}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              value === r.id ? 'bg-solid text-inverse' : 'text-muted hover:bg-raised'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

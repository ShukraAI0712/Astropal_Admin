'use client';

import { useState } from 'react';
import { useAnalytics } from '@/lib/analytics-context';
import { RANGE_LABELS, delta, num, sliceSeries, type Range } from '@/lib/analytics';
import { Caveat, Panel, Pill, StatCard, Table, Td, fmt } from '@/components/ui';
import { BarList, RangeTabs, SERIES, TimeSeries } from '@/components/charts';

/**
 * Reports - the most complete demand signal in the product.
 *
 * Unlike the chat categories, nothing here is a sample: every report anyone
 * asked for is a row in `report_queue`, including the ones that failed. Which
 * report types people choose is therefore the straightest answer available to
 * "what do readers actually want from us".
 */

const REPORT_LABELS: Record<string, string> = {
  career: 'Career',
  relationship: 'Relationship',
  wealth: 'Wealth',
  vedic_health: 'Vedic Health',
  life_numerology: 'Numerology',
  marriage_life: 'Life After Marriage',
  compatibility: 'Kundali Milan',
  baby_name: 'Baby Name',
  baby_name_vedic: 'Baby Name (Vedic)',
  baby_name_sikh: 'Baby Name (Sikh)',
  varshphal: 'Varshphal',
};

export default function ReportsPage() {
  const { data } = useAnalytics();
  const [range, setRange] = useState<Range>('90d');

  if (!data) return null;

  const rep = data.reports;
  const k = data.kpis;
  const { points, labels } = sliceSeries(data, range);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Reports</h1>
        <p className="mt-1 text-sm text-muted">
          Every report anyone asked for, including the ones that failed. This is the one
          complete record of what readers want.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Requested today"
          value={num(k.reports.today)}
          delta={delta(k.reports.today, k.reports.yesterday)}
          deltaLabel="vs yesterday"
        />
        <StatCard
          label="Last 30 days"
          value={num(k.reports.d30)}
          delta={delta(k.reports.d30, k.reports.prev30)}
          deltaLabel="vs prev 30"
        />
        <StatCard
          label="Succeeded"
          value={`${rep.queue.success_rate}%`}
          tone={rep.queue.success_rate < 90 ? 'warning' : 'good'}
          sub={`${num(rep.queue.completed)} of ${num(rep.queue.completed + rep.queue.failed)} finished`}
        />
        <StatCard
          label="Failed"
          value={num(rep.queue.failed)}
          goodWhenUp={false}
          tone={rep.queue.failed > 0 ? 'critical' : undefined}
          sub={`${num(rep.queue.pending)} still in the queue`}
        />
      </section>

      <Panel
        title="Reports requested"
        subtitle={`Over the ${RANGE_LABELS[range]}.`}
        action={<RangeTabs value={range} onChange={setRange} />}
      >
        <TimeSeries
          labels={labels}
          height={200}
          area
          lines={[
            { key: 'r', label: 'Reports', values: points.map((p) => p.reports), color: SERIES[0] },
          ]}
        />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Which reports people want"
          subtitle="All time, by number requested."
        >
          <BarList
            rows={rep.by_type.map((t) => ({
              label: REPORT_LABELS[t.type] ?? t.type,
              value: t.total,
              sub: `${t.users} people`,
            }))}
          />
          <div className="mt-5">
            <Caveat>
              A report that nobody asks for is either not wanted or not findable, and the
              two look identical here. Check the intake page before you retire one.
            </Caveat>
          </div>
        </Panel>

        <Panel
          title="Queue health"
          subtitle="The worker runs detached from the request, so a slow report never times out the page."
        >
          <div className="grid grid-cols-2 gap-5">
            <div>
              <p className="text-xs text-faint">Average generation</p>
              <p className="mt-0.5 text-2xl font-semibold text-ink">
                {rep.queue.avg_seconds}s
              </p>
            </div>
            <div>
              <p className="text-xs text-faint">Waiting now</p>
              <p className="mt-0.5 text-2xl font-semibold text-ink">{num(rep.queue.pending)}</p>
            </div>
          </div>
          <div className="mt-6 border-t border-line pt-5">
            <p className="mb-3 text-xs font-medium text-faint uppercase">Saved reports on file</p>
            <BarList
              rows={Object.entries(rep.saved)
                .filter(([, n]) => n > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([kind, n]) => ({ label: REPORT_LABELS[kind] ?? kind, value: n }))}
              color={SERIES[2]}
            />
          </div>
        </Panel>
      </div>

      <Panel
        title="Requests by type and window"
        subtitle="The same types, with recency. A type that is high all-time but zero for 30 days has stopped."
        bare
      >
        <Table
          head={[
            { label: 'Report' },
            { label: 'Today', align: 'right' },
            { label: '7 days', align: 'right' },
            { label: '30 days', align: 'right' },
            { label: 'Total', align: 'right' },
            { label: 'Failed', align: 'right' },
          ]}
        >
          {rep.by_type.map((t) => (
            <tr key={t.type}>
              <Td>{REPORT_LABELS[t.type] ?? t.type}</Td>
              <Td align="right" muted>{t.today}</Td>
              <Td align="right" muted>{t.d7}</Td>
              <Td align="right" muted>{t.d30}</Td>
              <Td align="right">{t.total}</Td>
              <Td align="right">
                {t.failed > 0 ? (
                  <span className="font-medium text-red-600 dark:text-red-400">{t.failed}</span>
                ) : (
                  <span className="text-faint">0</span>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>

      <Panel
        title="Recent failures"
        subtitle="Each of these is a reader who asked for something and got nothing."
        bare
      >
        {rep.failures.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-faint">
            No failed report jobs. All clear.
          </p>
        ) : (
          <div className="divide-y divide-line">
            {rep.failures.map((f, i) => (
              <div key={i} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill className="bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400">
                    {REPORT_LABELS[f.report_type] ?? f.report_type}
                  </Pill>
                  <span className="text-xs text-faint">
                    {fmt(f.updated_at)} &middot; attempt {f.attempt_count}
                  </span>
                </div>
                {f.last_error && (
                  <p className="mt-1.5 line-clamp-2 text-xs break-words text-faint">
                    {f.last_error}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

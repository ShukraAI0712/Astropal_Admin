'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useAnalytics } from '@/lib/analytics-context';
import {
  RANGE_LABELS, delta, funnelSteps, money, num, sliceSeries, type Range,
} from '@/lib/analytics';
import { Caveat, Panel, StatCard } from '@/components/ui';
import { LiveStrip, PeopleSheet, type SheetKind } from '@/components/people';
import {
  Funnel, RangeTabs, SERIES, Sparkline, StackedBar, TimeSeries,
} from '@/components/charts';

/**
 * Overview - the screen that answers "how are we doing" before you know what
 * to ask.
 *
 * It leads with one hero number and then eight tiles, each carrying its own
 * comparison period. Below them is the only chart on this page that changes
 * with the range picker, and below that the two panels that turn numbers into
 * a decision: what needs attention, and where the money went.
 */

export default function OverviewPage() {
  const { data } = useAnalytics();
  const [range, setRange] = useState<Range>('30d');
  // Which people sheet is open, or null. One piece of state rather than four
  // booleans: the sheets are mutually exclusive by construction.
  const [sheet, setSheet] = useState<SheetKind | null>(null);

  if (!data) return null;

  const k = data.kpis;
  const { points, labels, monthly } = sliceSeries(data, range);
  const spark = data.series.daily.slice(-12);

  // The attention list. Every row is a real count with a threshold that says
  // why it matters, and nothing appears unless it is actually true - an empty
  // list is the good outcome, not a broken panel.
  const attention: { label: string; detail: string; href: string; severe: boolean }[] = [];

  if (data.reports.queue.failed > 0) {
    attention.push({
      label: `${data.reports.queue.failed} report${data.reports.queue.failed === 1 ? '' : 's'} failed to generate`,
      detail: 'Someone paid or spent a token and got nothing back.',
      href: '/reports',
      severe: true,
    });
  }
  if (data.revenue.funnel.abandoned > 0) {
    attention.push({
      label: `${data.revenue.funnel.abandoned} checkouts abandoned`,
      detail: 'Orders created more than an hour ago that were never paid.',
      href: '/revenue',
      severe: data.revenue.funnel.abandoned > data.revenue.funnel.all.paid,
    });
  }
  if (data.support.open > 0) {
    attention.push({
      label: `${data.support.open} support ticket${data.support.open === 1 ? '' : 's'} open`,
      detail: `${data.support.new_7d} arrived in the last 7 days.`,
      href: '/support',
      severe: false,
    });
  }
  if (data.users.ghosts.count > 0) {
    attention.push({
      label: `${data.users.ghosts.count} accounts never did anything`,
      detail: 'Signed up, then no kundali, no chat, no report. Their emails are on the Users screen.',
      href: '/users',
      severe: data.users.ghosts.count > data.users.total * 0.15,
    });
  }
  if (data.users.lifecycle.dormant_30_90 > 0) {
    attention.push({
      label: `${data.users.lifecycle.dormant_30_90} accounts went quiet 30-90 days ago`,
      detail: 'Still winnable. Past 90 days they rarely come back.',
      href: '/users',
      severe: false,
    });
  }
  if (data.revenue.plan_churn.expiring_7d > 0) {
    attention.push({
      label: `${data.revenue.plan_churn.expiring_7d} paid plans expire within 7 days`,
      detail: `${data.revenue.plan_churn.auto_renew_on} accounts have auto-renew on.`,
      href: '/revenue',
      severe: true,
    });
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Overview</h1>
        <p className="mt-1 text-sm text-muted">
          Everything on this screen is as of{' '}
          {new Date(data.generated_at).toLocaleString('en-IN', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          })}
          , with days counted in {data.tz.replace('_', ' ')}.
        </p>
      </header>

      {/* Who is on the app at this second. Above the hero because it is the
          only thing here that is true *now* rather than true today. */}
      <LiveStrip data={data} onOpen={() => setSheet('live')} />

      {/* The hero: the one number the dashboard leads with. Active accounts
          rather than signups, because a signup is a cost until it comes back. */}
      <section className="rounded-xl border border-line bg-surface p-6">
        <p className="text-xs font-medium tracking-wide text-faint uppercase">
          Active accounts, last 30 days
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-x-5 gap-y-2">
          <p className="text-5xl font-semibold text-ink">{num(k.active_users.d30)}</p>
          {delta(k.active_users.d30, k.active_users.prev30) !== null && (
            <p
              className={`pb-2 text-sm font-medium ${
                k.active_users.d30 >= k.active_users.prev30
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {k.active_users.d30 >= k.active_users.prev30 ? '+' : ''}
              {delta(k.active_users.d30, k.active_users.prev30)}%
              <span className="ml-1 font-normal text-faint">vs the 30 days before</span>
            </p>
          )}
          <p className="pb-2 text-sm text-faint">
            of {num(data.users.total)} accounts ever
          </p>
        </div>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted">
          An account is active on a day it did anything we can see: asked a question, made
          a kundali, queued a report, started a checkout, or signed in.
        </p>
      </section>

      {/* The four "today" tiles open the list of people they are counting.
          The four below them are money and throughput, which are not lists of
          anyone, so they stay plain - see StatCard on why. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Questions today"
          value={num(k.questions.today)}
          delta={delta(k.questions.today, k.questions.yesterday)}
          deltaLabel="vs yesterday"
          sub={`${num(k.askers.today)} people`}
          trend={<Sparkline values={spark.map((p) => p.questions)} color={SERIES[0]} />}
          onOpen={() => setSheet('questions')}
          openLabel="See who asked something today"
        />
        <StatCard
          label="Active today"
          value={num(k.active_users.today)}
          delta={delta(k.active_users.today, k.active_users.yesterday)}
          deltaLabel="vs yesterday"
          sub={`${data.users.today_split.returning} returning`}
          trend={<Sparkline values={spark.map((p) => p.active)} color={SERIES[2]} />}
          onOpen={() => setSheet('active')}
          openLabel="See who was active today"
        />
        <StatCard
          label="New signups today"
          value={num(k.new_users.today)}
          delta={delta(k.new_users.today, k.new_users.yesterday)}
          deltaLabel="vs yesterday"
          sub={`${num(k.new_users.d30)} in 30 days`}
          trend={<Sparkline values={spark.map((p) => p.new_users)} color={SERIES[1]} />}
          onOpen={() => setSheet('new')}
          openLabel="See who signed up today"
        />
        <StatCard
          label="Sign-ins today"
          value={num(k.logins.today)}
          delta={delta(k.logins.today, k.logins.yesterday)}
          deltaLabel="vs yesterday"
          sub={`${num(data.users.logged_in_today.length)} accounts`}
          trend={<Sparkline values={spark.map((p) => p.logins)} color={SERIES[6]} />}
          onOpen={() => setSheet('signed_in')}
          openLabel="See who signed in today"
        />
        <StatCard
          label="Revenue, 30 days"
          value={money(k.revenue.d30)}
          delta={delta(k.revenue.d30, k.revenue.prev30)}
          deltaLabel="vs prev 30"
          sub={`${money(k.revenue.all ?? 0)} all time`}
        />
        <StatCard
          label="Orders, 30 days"
          value={num(k.orders.d30)}
          sub={`${num(data.revenue.funnel.d30.paid)} paid, ${num(data.revenue.funnel.d30.failed)} failed`}
        />
        <StatCard
          label="Reports, 30 days"
          value={num(k.reports.d30)}
          delta={delta(k.reports.d30, k.reports.prev30)}
          deltaLabel="vs prev 30"
          sub={`${data.reports.queue.success_rate}% succeed`}
        />
        <StatCard
          label="Returning rate, 30 days"
          value={`${data.users.returning.d30.rate}%`}
          sub={`${num(data.users.returning.d30.multi_day)} of ${num(data.users.returning.d30.active)} came back`}
        />
      </section>

      <Panel
        title="Activity"
        subtitle={`Questions, active accounts and new signups over the ${RANGE_LABELS[range]}.`}
        action={<RangeTabs value={range} onChange={setRange} />}
      >
        <TimeSeries
          labels={labels}
          height={240}
          lines={[
            { key: 'questions', label: 'Questions', values: points.map((p) => p.questions), color: SERIES[0] },
            { key: 'active', label: 'Active accounts', values: points.map((p) => p.active), color: SERIES[2] },
            { key: 'new', label: 'New signups', values: points.map((p) => p.new_users), color: SERIES[1] },
          ]}
        />
        {monthly && (
          <p className="mt-3 text-xs text-faint">
            Monthly buckets. The current month is still filling, so its last point is
            always short.
          </p>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Needs attention"
          subtitle="Only rows that are actually true right now."
          bare
        >
          {attention.length === 0 ? (
            <div className="flex items-center gap-3 px-5 py-8">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm text-muted">
                Nothing is failing, queued or overdue. Go build something.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {attention.map((a) => (
                <li key={a.label}>
                  <Link
                    href={a.href}
                    className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-raised"
                  >
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0"
                      style={{
                        color: a.severe ? 'var(--status-critical)' : 'var(--status-warning)',
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink">{a.label}</span>
                      <span className="mt-0.5 block text-xs text-muted">{a.detail}</span>
                    </span>
                    <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Checkout funnel, last 30 days"
          subtitle="Every order created, and what became of it."
        >
          <StackedBar
            parts={[
              { label: 'Paid', value: data.revenue.funnel.d30.paid, color: 'var(--status-good)' },
              { label: 'Failed', value: data.revenue.funnel.d30.failed, color: 'var(--status-critical)' },
              { label: 'Still open', value: data.revenue.funnel.d30.open, color: 'var(--status-warning)' },
            ]}
          />
          <div className="mt-5">
            <Caveat>
              An order sits at <strong>open</strong> from the moment the Razorpay modal
              is created. One still open an hour later was abandoned, not lost in
              flight - {num(data.revenue.funnel.abandoned)} orders are in that state
              right now, which is a checkout problem rather than a payments one.
            </Caveat>
          </div>
        </Panel>
      </div>

      <Panel
        title="The journey, all time"
        subtitle="Of every account that ever signed up, how far each one got."
        action={
          <Link
            href="/journey"
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-raised"
          >
            Open the funnel
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        <Funnel steps={funnelSteps(data.journey.windows.all)} />
      </Panel>

      <PeopleSheet kind={sheet} data={data} onClose={() => setSheet(null)} />
    </div>
  );
}

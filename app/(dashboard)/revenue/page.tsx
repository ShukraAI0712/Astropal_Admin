'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAnalytics } from '@/lib/analytics-context';
import { RANGE_LABELS, delta, money, num, sliceSeries, type Range } from '@/lib/analytics';
import {
  Caveat, Empty, Panel, Pill, PLAN_COLORS, StatCard, Table, Td, fmt,
} from '@/components/ui';
import { BarList, RangeTabs, SERIES, StackedBar, TimeSeries } from '@/components/charts';

/**
 * Revenue - what was paid, and just as importantly what was attempted and did
 * not arrive.
 *
 * `payments` holds one row per order created, so the failures and the
 * abandonments are visible here rather than inferred. That is the only way to
 * separate "nobody wants to buy" from "the buy button is broken", and they are
 * completely different problems.
 */

const ITEM_LABELS: Record<string, string> = {
  credits_30: '30 questions',
  credits_300: '300 questions',
  report_token: 'Premium report',
  pro: 'Pro plan',
  ultra: 'Ultra plan',
};

const STATUS_STYLE: Record<string, string> = {
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  created: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
};

export default function RevenuePage() {
  const { data } = useAnalytics();
  const [range, setRange] = useState<Range>('90d');
  const [funnelWindow, setFunnelWindow] = useState<'d7' | 'd30' | 'd365' | 'all'>('d30');

  if (!data) return null;

  const r = data.revenue;
  const k = data.kpis;
  const { points, labels } = sliceSeries(data, range);
  const f = r.funnel[funnelWindow];
  const conversion = f.created ? Math.round((f.paid / f.created) * 100) : 0;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Revenue</h1>
        <p className="mt-1 text-sm text-muted">
          Every order ever created, paid or not. Amounts are in rupees, converted from the
          paise the payments table stores.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Revenue, 30 days"
          value={money(k.revenue.d30)}
          delta={delta(k.revenue.d30, k.revenue.prev30)}
          deltaLabel="vs prev 30"
        />
        <StatCard label="All time" value={money(k.revenue.all ?? 0)} sub={`${num(r.customers.paying)} paying accounts`} />
        <StatCard
          label="Paid orders, 30 days"
          value={num(r.funnel.d30.paid)}
          sub={`of ${num(r.funnel.d30.created)} created`}
        />
        <StatCard
          label="Abandoned checkouts"
          value={num(r.funnel.abandoned)}
          goodWhenUp={false}
          tone={r.funnel.abandoned > r.funnel.all.paid ? 'critical' : undefined}
          sub="open over an hour"
        />
      </section>

      <Panel
        title="Orders and revenue"
        subtitle={`Over the ${RANGE_LABELS[range]}. Orders created is the demand signal; paid is what survived checkout.`}
        action={<RangeTabs value={range} onChange={setRange} />}
      >
        <TimeSeries
          labels={labels}
          height={220}
          lines={[
            { key: 'created', label: 'Orders created', values: points.map((p) => p.orders), color: SERIES[3] },
            { key: 'paid', label: 'Orders paid', values: points.map((p) => p.paid), color: SERIES[6] },
          ]}
        />
        <div className="mt-6 border-t border-line pt-6">
          <TimeSeries
            labels={labels}
            height={160}
            area
            lines={[
              {
                key: 'rev',
                label: 'Revenue',
                values: points.map((p) => Math.round(p.revenue / 100)),
                color: SERIES[0],
                format: (n) => `₹${n.toLocaleString('en-IN')}`,
              },
            ]}
          />
          <p className="mt-2 text-xs text-faint">Revenue in rupees, on its own axis.</p>
        </div>
        <div className="mt-5">
          <Caveat>
            Two charts rather than two y-axes on one. Orders and rupees are different
            scales, and a dual axis lets whoever drew it choose where the lines cross -
            which is a claim the data never made.
          </Caveat>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Checkout funnel"
          subtitle="What happened to every order created in the window."
          action={
            <div className="inline-flex rounded-lg border border-line p-0.5">
              {(['d7', 'd30', 'd365', 'all'] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => setFunnelWindow(w)}
                  aria-pressed={funnelWindow === w}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    funnelWindow === w ? 'bg-solid text-inverse' : 'text-muted hover:bg-raised'
                  }`}
                >
                  {w === 'all' ? 'All' : w === 'd365' ? '1y' : w === 'd30' ? '30d' : '7d'}
                </button>
              ))}
            </div>
          }
        >
          <StackedBar
            parts={[
              { label: 'Paid', value: f.paid, color: 'var(--status-good)' },
              { label: 'Failed', value: f.failed, color: 'var(--status-critical)' },
              { label: 'Still open', value: f.open, color: 'var(--status-warning)' },
            ]}
          />
          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-5">
            <div>
              <p className="text-xs text-faint">Orders created</p>
              <p className="mt-0.5 text-xl font-semibold text-ink">{num(f.created)}</p>
            </div>
            <div>
              <p className="text-xs text-faint">Reached payment</p>
              <p
                className="mt-0.5 text-xl font-semibold"
                style={{ color: conversion < 25 ? 'var(--status-critical)' : 'var(--status-good)' }}
              >
                {conversion}%
              </p>
            </div>
          </div>
          <div className="mt-5">
            <Caveat>
              <strong>Still open</strong> is not a pending payment. A row moves from
              created to paid in one write, so anything still open long after the fact
              is a person who opened the Razorpay modal and walked away. That makes it a
              pricing or trust problem at the modal, not a gateway failure.
            </Caveat>
          </div>
        </Panel>

        <Panel
          title="What sells"
          subtitle="Every purchasable item, all time. Orders created against what was actually paid."
        >
          <BarList
            rows={r.by_item.map((i) => ({
              label: ITEM_LABELS[i.item] ?? i.item,
              value: i.created,
              sub: `${i.paid} paid`,
            }))}
            color={SERIES[3]}
          />
          <div className="mt-6 border-t border-line pt-5">
            <p className="mb-3 text-xs font-medium text-faint uppercase">Revenue by item</p>
            <BarList
              rows={r.by_item
                .filter((i) => i.revenue > 0)
                .map((i) => ({
                  label: ITEM_LABELS[i.item] ?? i.item,
                  value: i.revenue,
                  sub: `${i.buyers} buyers`,
                }))}
              color={SERIES[0]}
              format={(n) => money(n)}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Why payments failed"
          subtitle="Grouped by the reason Razorpay gave."
        >
          {r.failures.length === 0 ? (
            <p className="py-6 text-center text-sm text-faint">No failed payments.</p>
          ) : (
            <BarList
              rows={r.failures.map((x) => ({ label: x.reason, value: x.count }))}
              color="var(--status-critical)"
            />
          )}
        </Panel>

        <Panel title="Customers" subtitle="Accounts that have paid at least once.">
          <div className="grid grid-cols-2 gap-5">
            <div>
              <p className="text-xs text-faint">Paying accounts</p>
              <p className="mt-0.5 text-2xl font-semibold text-ink">{num(r.customers.paying)}</p>
              <p className="mt-0.5 text-xs text-faint">
                {r.customers.repeat} bought more than once
              </p>
            </div>
            <div>
              <p className="text-xs text-faint">Average lifetime spend</p>
              <p className="mt-0.5 text-2xl font-semibold text-ink">
                &#8377;{num(r.customers.lifetime_avg)}
              </p>
              <p className="mt-0.5 text-xs text-faint">
                best &#8377;{num(r.customers.lifetime_max)}
              </p>
            </div>
            <div>
              <p className="text-xs text-faint">Conversion, all time</p>
              <p className="mt-0.5 text-2xl font-semibold text-ink">
                {data.users.total
                  ? ((r.customers.paying / data.users.total) * 100).toFixed(1)
                  : '0'}
                %
              </p>
              <p className="mt-0.5 text-xs text-faint">of {num(data.users.total)} accounts</p>
            </div>
            <div>
              <p className="text-xs text-faint">Auto-renew on</p>
              <p className="mt-0.5 text-2xl font-semibold text-ink">
                {num(r.plan_churn.auto_renew_on)}
              </p>
              <p className="mt-0.5 text-xs text-faint">
                {r.plan_churn.cancelled_30d} cancelled in 30d
              </p>
            </div>
          </div>
        </Panel>
      </div>

      {r.top_customers.length > 0 && (
        <Panel
          title="Biggest customers"
          subtitle="By total paid, all time."
          bare
        >
          <Table
            head={[
              { label: 'Email' },
              { label: 'Plan' },
              { label: 'Orders', align: 'right' },
              { label: 'Spend', align: 'right' },
            ]}
          >
            {r.top_customers.map((c) => (
              <tr key={c.user_id}>
                <Td>{c.email ?? <span className="text-faint">{c.user_id.slice(0, 8)}</span>}</Td>
                <Td>
                  <Pill className={PLAN_COLORS[c.plan ?? 'basic'] ?? PLAN_COLORS.basic}>
                    {c.plan ?? 'basic'}
                  </Pill>
                </Td>
                <Td align="right" muted>{c.orders}</Td>
                <Td align="right">{money(c.spend)}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      <Panel
        title="Recent orders"
        subtitle="The last 50, whatever happened to them."
        bare
      >
        {r.recent.length === 0 ? (
          <Empty>No orders yet.</Empty>
        ) : (
          <Table
            minWidth={720}
            head={[
              { label: 'When' },
              { label: 'Account' },
              { label: 'Item' },
              { label: 'Status' },
              { label: 'Amount', align: 'right' },
            ]}
          >
            {r.recent.map((p, i) => (
              <tr key={`${p.created_at}-${i}`}>
                <Td muted className="whitespace-nowrap">{fmt(p.created_at)}</Td>
                <Td className="max-w-[240px] truncate" >{p.email ?? <span className="text-faint">-</span>}</Td>
                <Td muted className="whitespace-nowrap">
                  {ITEM_LABELS[p.item] ?? p.item}
                  {p.coupon_code && (
                    <span className="ml-2 text-xs text-faint">{p.coupon_code}</span>
                  )}
                </Td>
                {/* The failure reason sits UNDER the pill rather than beside
                    it. Inline, one long decline message widened the whole
                    table past the amount column, which is the one number
                    somebody scanning this list is actually looking for. */}
                <Td>
                  <Pill className={STATUS_STYLE[p.status] ?? 'bg-raised text-muted'}>
                    {p.status === 'created' ? 'open' : p.status}
                  </Pill>
                  {p.failure_reason && (
                    <span className="mt-1 block max-w-[200px] text-xs text-faint">
                      {p.failure_reason}
                    </span>
                  )}
                </Td>
                <Td align="right" className="whitespace-nowrap">
                  {money(p.amount)}
                  {p.discount_amount ? (
                    <span className="ml-1 text-xs text-faint">
                      -{money(p.discount_amount)}
                    </span>
                  ) : null}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Subscriptions" subtitle="Razorpay auto-renewing mandates.">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-faint">Total</p>
              <p className="mt-0.5 text-xl font-semibold text-ink">{num(r.subscriptions.total)}</p>
            </div>
            <div>
              <p className="text-xs text-faint">Active</p>
              <p className="mt-0.5 text-xl font-semibold text-ink">{num(r.subscriptions.active)}</p>
            </div>
            <div>
              <p className="text-xs text-faint">Cancelled</p>
              <p className="mt-0.5 text-xl font-semibold text-ink">
                {num(r.subscriptions.cancelled)}
              </p>
            </div>
          </div>
          {Object.keys(r.subscriptions.by_plan).length > 0 && (
            <div className="mt-5 border-t border-line pt-5">
              <BarList
                rows={Object.entries(r.subscriptions.by_plan).map(([plan, n]) => ({
                  label: plan,
                  value: n,
                }))}
                color={SERIES[2]}
              />
            </div>
          )}
        </Panel>

        <Panel
          title="Coupons"
          subtitle="A summary. The Coupons screen is where they are created and managed."
          action={
            <Link
              href="/coupons"
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-raised"
            >
              Manage
            </Link>
          }
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-faint">Codes</p>
              <p className="mt-0.5 text-xl font-semibold text-ink">
                {num(data.coupons.total)}
                <span className="ml-1.5 text-xs font-normal text-faint">
                  {data.coupons.active} live
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs text-faint">Live redemptions</p>
              <p className="mt-0.5 text-xl font-semibold text-ink">
                {num(data.coupons.redemptions.live)}
              </p>
            </div>
            <div>
              <p className="text-xs text-faint">Codes tried</p>
              <p className="mt-0.5 text-xl font-semibold text-ink">
                {num(data.coupons.attempts.total)}
                <span className="ml-1.5 text-xs font-normal text-faint">
                  {data.coupons.attempts.failure} rejected
                </span>
              </p>
            </div>
            <div>
              <p className="text-xs text-faint">Discount given</p>
              <p className="mt-0.5 text-xl font-semibold text-ink">
                {money(data.coupons.redemptions.discount_given)}
              </p>
            </div>
          </div>
          {data.coupons.attempts.by_failure.length > 0 && (
            <div className="mt-5 border-t border-line pt-5">
              <p className="mb-3 text-xs font-medium text-faint uppercase">Why codes were rejected</p>
              <BarList
                rows={data.coupons.attempts.by_failure.map((x) => ({
                  label: x.code.replace(/_/g, ' '),
                  value: x.count,
                }))}
                color="var(--status-warning)"
              />
              <p className="mt-4 text-xs text-muted">
                A lot of <em>invalid code</em> usually means a code is being shared in a
                form nobody typed correctly - matching is byte-exact, so ASTRO20 and
                astro20 are different coupons.
              </p>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

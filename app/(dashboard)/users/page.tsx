'use client';

import { useState } from 'react';
import { useAnalytics } from '@/lib/analytics-context';
import {
  RANGE_LABELS, delta, name as personName, num, sliceSeries, type Range,
} from '@/lib/analytics';
import {
  Caveat, CopyEmails, Empty, Panel, Pill, PLAN_COLORS, StatCard, Table, Td, fmt,
} from '@/components/ui';
import {
  BarList, CohortGrid, RangeTabs, SERIES, StackedBar, TimeSeries,
} from '@/components/charts';

/**
 * Users - acquisition on the left of the funnel, retention on the right, and
 * the two lists of email addresses that are the point of the whole screen.
 *
 * Ghost accounts and accounts that came once are not statistics here; they are
 * a campaign you can copy to the clipboard.
 */

export default function UsersPage() {
  const { data } = useAnalytics();
  const [range, setRange] = useState<Range>('30d');

  if (!data) return null;

  const u = data.users;
  const k = data.kpis;
  const { points, labels } = sliceSeries(data, range);
  const lc = u.lifecycle;
  const everActive = lc.days_1 + lc.days_2_3 + lc.days_4_7 + lc.days_8plus;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Users &amp; retention</h1>
        <p className="mt-1 text-sm text-muted">
          {num(u.total)} accounts have ever existed. This screen is about which of them
          are still here.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="New today"
          value={num(k.new_users.today)}
          delta={delta(k.new_users.today, k.new_users.yesterday)}
          deltaLabel="vs yesterday"
        />
        <StatCard
          label="New, 30 days"
          value={num(k.new_users.d30)}
          delta={delta(k.new_users.d30, k.new_users.prev30)}
          deltaLabel="vs prev 30"
        />
        <StatCard
          label="Active, 7 days"
          value={num(k.active_users.d7)}
          delta={delta(k.active_users.d7, k.active_users.prev7)}
          deltaLabel="vs prev 7"
        />
        <StatCard
          label="Came back, 30 days"
          value={`${u.returning.d30.rate}%`}
          sub={`${num(u.returning.d30.multi_day)} of ${num(u.returning.d30.active)} on 2+ days`}
        />
      </section>

      <Panel
        title="Signups against activity"
        subtitle={`Over the ${RANGE_LABELS[range]}. Signups climbing while active accounts flatten is an acquisition that is not sticking.`}
        action={<RangeTabs value={range} onChange={setRange} />}
      >
        <TimeSeries
          labels={labels}
          height={240}
          lines={[
            { key: 'new', label: 'New signups', values: points.map((p) => p.new_users), color: SERIES[1] },
            { key: 'active', label: 'Active accounts', values: points.map((p) => p.active), color: SERIES[2] },
            { key: 'login', label: 'Accounts signing in', values: points.map((p) => p.login_users), color: SERIES[6] },
          ]}
        />
        <div className="mt-4">
          <Caveat>
            <strong>Signing in</strong> counts new sessions, not app opens. A reader who
            keeps using the same phone stays in one session that is refreshed rather than
            replaced, so they appear under active accounts and not here. There is no
            page-view table in this database, so a true &ldquo;opened the dashboard&rdquo; or
            &ldquo;read their Rashifal&rdquo; count does not exist yet - see ANALYTICS.md for
            the one change that would add it.
          </Caveat>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="How deep the habit goes"
          subtitle={`Every account that was ever active, by how many separate days it showed up.`}
        >
          <StackedBar
            parts={[
              { label: 'One day only', value: lc.days_1, color: SERIES[7] },
              { label: '2-3 days', value: lc.days_2_3, color: SERIES[3] },
              { label: '4-7 days', value: lc.days_4_7, color: SERIES[2] },
              { label: '8+ days', value: lc.days_8plus, color: SERIES[6] },
            ]}
          />
          <p className="mt-4 text-xs leading-relaxed text-muted">
            {everActive > 0 && (
              <>
                {Math.round((lc.days_1 / everActive) * 100)}% of everyone who has ever been
                active came exactly once.{' '}
              </>
            )}
            The second day is the whole game: accounts that reach it behave completely
            differently from accounts that do not.
          </p>
        </Panel>

        <Panel
          title="Where accounts stand today"
          subtitle="Each account counted once, by when it was last active."
        >
          <BarList
            rows={[
              { label: 'Active in the last 7 days', value: lc.active_7d, color: 'var(--status-good)' },
              { label: 'Active in the last 30 days', value: lc.active_30d, color: SERIES[2] },
              { label: 'Quiet 30-90 days', value: lc.dormant_30_90, color: 'var(--status-warning)' },
              { label: 'Quiet over 90 days', value: lc.dormant_90, color: 'var(--status-serious)' },
              { label: 'Never did anything', value: lc.never_active, color: 'var(--status-critical)' },
            ]}
          />
          <p className="mt-4 text-xs text-muted">
            The first two overlap by design - a 7-day active account is also a 30-day
            one. The last three do not overlap with anything.
          </p>
        </Panel>
      </div>

      <Panel
        title="Retention by signup week"
        subtitle="Of the accounts that signed up in a week, how many were still active one, two, three and four weeks later."
      >
        <CohortGrid rows={u.cohorts} />
        <p className="mt-4 text-xs text-muted">
          Read down a column, not across a row: the newest cohorts have not had four
          weeks yet, so their right-hand cells are empty rather than zero.
        </p>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="By plan">
          <BarList
            rows={['basic', 'pro', 'ultra']
              .filter((p) => u.by_plan[p] !== undefined)
              .map((p) => ({
                label: p,
                value: u.by_plan[p] ?? 0,
                sub: `${Math.round(((u.by_plan[p] ?? 0) / u.total) * 100)}%`,
              }))}
          />
        </Panel>
        <Panel title="Reachable">
          <BarList
            max={u.total}
            rows={[
              { label: 'Marketing consent', value: u.marketing_consent },
              { label: 'WhatsApp channel', value: u.whatsapp_connected, color: SERIES[2] },
              { label: 'Onboarding incomplete', value: u.onboarding_incomplete, color: 'var(--status-warning)' },
            ]}
          />
          <p className="mt-4 text-xs text-muted">
            Bars are against all {num(u.total)} accounts. Consent is an affirmative act -
            the rest were never asked, or said no, and must not be mailed.
          </p>
        </Panel>
        <Panel title="Staff accounts">
          <BarList
            rows={Object.entries(u.by_role)
              .sort((a, b) => b[1] - a[1])
              .map(([role, n]) => ({ label: role.replace('_', ' '), value: n }))}
            color={SERIES[6]}
          />
        </Panel>
      </div>

      <Panel
        title={`Signed up and never did anything (${num(u.ghosts.count)})`}
        subtitle="No kundali, no chat, no report, no order. The clearest re-activation list you have."
        action={<CopyEmails emails={u.ghosts.list.map((g) => g.email)} />}
        bare
      >
        {u.ghosts.list.length === 0 ? (
          <Empty>Every account has done something. That is unusual and good.</Empty>
        ) : (
          <>
            <Table
              head={[
                { label: 'Name' },
                { label: 'Email' },
                { label: 'Signed up' },
                { label: 'Days ago', align: 'right' },
              ]}
            >
              {u.ghosts.list.map((g) => (
                <tr key={g.user_id}>
                  <Td>{personName(g)}</Td>
                  <Td muted>{g.email ?? <span className="text-faint">{g.user_id.slice(0, 8)}</span>}</Td>
                  <Td muted>{fmt(g.created_at)}</Td>
                  <Td align="right" muted>{g.days_since}</Td>
                </tr>
              ))}
            </Table>
            {u.ghosts.count > u.ghosts.list.length && (
              <p className="border-t border-line px-5 py-3 text-xs text-faint">
                Showing the {u.ghosts.list.length} most recent of {num(u.ghosts.count)}.
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel
        title={`Came once and never came back (${num(u.never_returned.count)})`}
        subtitle="Active on exactly one calendar day, ever. They tried it and something did not land."
        action={<CopyEmails emails={u.never_returned.list.map((g) => g.email)} />}
        bare
      >
        {u.never_returned.list.length === 0 ? (
          <Empty>Everyone who showed up came back at least twice.</Empty>
        ) : (
          <>
            <Table
              head={[
                { label: 'Name' },
                { label: 'Email' },
                { label: 'Signed up' },
                { label: 'Last sign-in' },
              ]}
            >
              {u.never_returned.list.map((g) => (
                <tr key={g.user_id}>
                  <Td>{personName(g)}</Td>
                  <Td muted>{g.email ?? <span className="text-faint">{g.user_id.slice(0, 8)}</span>}</Td>
                  <Td muted>{fmt(g.created_at)}</Td>
                  <Td muted>{fmt(g.last_sign_in_at)}</Td>
                </tr>
              ))}
            </Table>
            {u.never_returned.count > u.never_returned.list.length && (
              <p className="border-t border-line px-5 py-3 text-xs text-faint">
                Showing the {u.never_returned.list.length} most recent of{' '}
                {num(u.never_returned.count)}.
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel
        title={`Signed in today (${num(u.logged_in_today.length)})`}
        subtitle="New sessions started today, with whether the account is new."
        bare
      >
        {u.logged_in_today.length === 0 ? (
          <Empty>Nobody has started a new session today.</Empty>
        ) : (
          <Table
            head={[
              { label: 'Name' },
              { label: 'Email' },
              { label: 'Plan' },
              { label: '' },
              { label: 'Sign-ins', align: 'right' },
            ]}
          >
            {u.logged_in_today.map((l) => (
              <tr key={l.user_id}>
                <Td>{personName(l)}</Td>
                <Td muted>{l.email ?? <span className="text-faint">{l.user_id.slice(0, 8)}</span>}</Td>
                <Td>
                  <Pill className={PLAN_COLORS[l.plan ?? 'basic'] ?? PLAN_COLORS.basic}>
                    {l.plan ?? 'basic'}
                  </Pill>
                </Td>
                <Td>
                  {l.is_new ? (
                    <Pill className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                      New
                    </Pill>
                  ) : (
                    <span className="text-xs text-faint">Returning</span>
                  )}
                </Td>
                <Td align="right">{l.logins}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  );
}

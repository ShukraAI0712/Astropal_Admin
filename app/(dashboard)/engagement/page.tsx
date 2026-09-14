'use client';

import { useState } from 'react';
import { useAnalytics } from '@/lib/analytics-context';
import { RANGE_LABELS, delta, num, sliceSeries, type Range } from '@/lib/analytics';
import { Caveat, Empty, Panel, Pill, PLAN_COLORS, StatCard, Table, Td } from '@/components/ui';
import { BarList, RangeTabs, SERIES, StackedBar, TimeSeries } from '@/components/charts';

/**
 * Engagement - how much is being asked, by whom, and about what.
 *
 * The "about what" is the part that needs a footnote rather than a bigger
 * chart. The product has no per-message topic column, and this dashboard does
 * not invent one: it reports the category model the product already writes
 * (`user_memories.category`) and says out loud how much of the conversation
 * that model actually covers.
 */

/** The eight categories the memory extractor uses, in a fixed colour order. */
const CATEGORY_COLOR: Record<string, string> = {
  Relationships: SERIES[0],
  Career: SERIES[1],
  Education: SERIES[2],
  Finance: SERIES[3],
  Health: SERIES[4],
  Family: SERIES[5],
  Other: SERIES[6],
  Uncategorised: SERIES[7],
};

export default function EngagementPage() {
  const { data } = useAnalytics();
  const [range, setRange] = useState<Range>('30d');
  const [catWindow, setCatWindow] = useState<'d7' | 'd30' | 'd365'>('d30');

  if (!data) return null;

  const k = data.kpis;
  const e = data.engagement;
  const { points, labels } = sliceSeries(data, range);
  const cov = data.categories.coverage;
  const coveragePct = cov.sessions_total
    ? Math.round((cov.sessions_with_memory / cov.sessions_total) * 100)
    : 0;

  const cats = [...data.categories.memories].sort((a, b) => b[catWindow] - a[catWindow]);
  const dist = e.distribution_30d;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Engagement</h1>
        <p className="mt-1 text-sm text-muted">
          A question is one message a reader sent in chat. Reports and Rashifal reads are
          counted on their own screens.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Questions today"
          value={num(k.questions.today)}
          delta={delta(k.questions.today, k.questions.yesterday)}
          deltaLabel="vs yesterday"
          sub={`${num(k.askers.today)} people asked`}
        />
        <StatCard
          label="Questions, 7 days"
          value={num(k.questions.d7)}
          delta={delta(k.questions.d7, k.questions.prev7)}
          deltaLabel="vs prev 7"
          sub={`${num(k.askers.d7)} people`}
        />
        <StatCard
          label="Questions, 30 days"
          value={num(k.questions.d30)}
          delta={delta(k.questions.d30, k.questions.prev30)}
          deltaLabel="vs prev 30"
          sub={`${num(k.askers.d30)} people`}
        />
        <StatCard
          label="All time"
          value={num(k.questions.all ?? 0)}
          sub={`${num(e.chat_sessions.all)} chats, ${e.chat_sessions.avg_questions_per_session} per chat`}
        />
      </section>

      <Panel
        title="Questions and the people asking them"
        subtitle={`Volume against reach over the ${RANGE_LABELS[range]}. When the lines diverge, a few readers are carrying the total.`}
        action={<RangeTabs value={range} onChange={setRange} />}
      >
        <TimeSeries
          labels={labels}
          height={240}
          lines={[
            { key: 'q', label: 'Questions', values: points.map((p) => p.questions), color: SERIES[0] },
            { key: 'a', label: 'People asking', values: points.map((p) => p.askers), color: SERIES[2] },
          ]}
        />
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="What readers are talking about"
          subtitle="From user_memories.category - the category the astrologer itself assigned when it decided something was worth remembering."
          action={
            <div className="inline-flex rounded-lg border border-line p-0.5">
              {(['d7', 'd30', 'd365'] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => setCatWindow(w)}
                  aria-pressed={catWindow === w}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    catWindow === w ? 'bg-solid text-inverse' : 'text-muted hover:bg-raised'
                  }`}
                >
                  {w === 'd7' ? '7d' : w === 'd30' ? '30d' : '1y'}
                </button>
              ))}
            </div>
          }
        >
          <BarList
            rows={cats.map((c) => ({
              label: c.category,
              value: c[catWindow],
              sub: `${c.users} people`,
              color: CATEGORY_COLOR[c.category] ?? SERIES[7],
            }))}
          />
          <div className="mt-5">
            <Caveat>
              This is a <strong>sample, not a census</strong>. A memory is only written
              when the reader says something worth remembering, so these categories cover{' '}
              <strong>
                {num(cov.sessions_with_memory)} of {num(cov.sessions_total)} chats ({coveragePct}%)
              </strong>
              , and only since{' '}
              {cov.first_memory_at
                ? new Date(cov.first_memory_at).toLocaleDateString('en-IN', {
                    month: 'long', year: 'numeric',
                  })
                : 'the feature shipped'}
              . Read it as the shape of what people bring, not as a count of questions.
              For complete demand by life area, the Reports screen is exact: every report
              anyone asked for is a row.
            </Caveat>
          </div>
        </Panel>

        <div className="space-y-6">
          <Panel
            title="How many questions each person asks"
            subtitle="Accounts that asked anything in the last 30 days, bucketed."
          >
            <StackedBar
              parts={[
                { label: '1 question', value: dist.q1, color: SERIES[7] },
                { label: '2-5', value: dist.q2_5, color: SERIES[3] },
                { label: '6-20', value: dist.q6_20, color: SERIES[2] },
                { label: '21-50', value: dist.q21_50, color: SERIES[0] },
                { label: '51+', value: dist.q51plus, color: SERIES[6] },
              ]}
            />
            <p className="mt-4 text-xs leading-relaxed text-muted">
              Median {dist.median}, mean {dist.mean}. The gap between them is the whole
              story: a mean pulled above the median means a handful of heavy readers are
              carrying the volume, and the median is what a typical person actually does.
            </p>
          </Panel>

          <Panel title="Chats and quota" subtitle="Two different counts of the same activity.">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-faint">Chats started, 30 days</p>
                <p className="mt-0.5 text-xl font-semibold text-ink">{num(e.chat_sessions.d30)}</p>
                <p className="mt-0.5 text-xs text-faint">
                  {e.chat_sessions.avg_questions_per_session} questions per chat
                </p>
              </div>
              <div>
                <p className="text-xs text-faint">Quota questions, 30 days</p>
                <p className="mt-0.5 text-xl font-semibold text-ink">{num(e.quota_questions.d30)}</p>
                <p className="mt-0.5 text-xs text-faint">{num(e.quota_questions.all)} all time</p>
              </div>
            </div>
            <div className="mt-5">
              <Caveat>
                Quota questions are what the billing side counts and they are lower on
                purpose - not every message spends a question. When the two drift far
                apart, people are typing a lot without being charged, which is a cost
                question rather than an engagement one.
              </Caveat>
            </div>
          </Panel>
        </div>
      </div>

      <Panel
        title={`Who asked today (${num(e.today_by_user.length)} ${e.today_by_user.length === 1 ? 'person' : 'people'})`}
        subtitle="Every account that sent a message today, heaviest first."
        bare
      >
        {e.today_by_user.length === 0 ? (
          <Empty>Nobody has asked anything yet today.</Empty>
        ) : (
          <Table head={[{ label: 'Account' }, { label: 'Plan' }, { label: 'Questions', align: 'right' }]}>
            {e.today_by_user.map((u) => (
              <tr key={u.user_id}>
                <Td>{u.email ?? <span className="text-faint">{u.user_id.slice(0, 8)}</span>}</Td>
                <Td>
                  <Pill className={PLAN_COLORS[u.plan ?? 'basic'] ?? PLAN_COLORS.basic}>
                    {u.plan ?? 'basic'}
                  </Pill>
                </Td>
                <Td align="right">{u.questions}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel
        title="Heaviest readers, last 30 days"
        subtitle="The accounts your costs and your word of mouth both come from."
        bare
      >
        {e.top_askers_30d.length === 0 ? (
          <Empty>No questions in the last 30 days.</Empty>
        ) : (
          <Table
            head={[
              { label: 'Account' },
              { label: 'Plan' },
              { label: 'Days active', align: 'right' },
              { label: 'Questions', align: 'right' },
            ]}
          >
            {e.top_askers_30d.map((u) => (
              <tr key={u.user_id}>
                <Td>{u.email ?? <span className="text-faint">{u.user_id.slice(0, 8)}</span>}</Td>
                <Td>
                  <Pill className={PLAN_COLORS[u.plan ?? 'basic'] ?? PLAN_COLORS.basic}>
                    {u.plan ?? 'basic'}
                  </Pill>
                </Td>
                <Td align="right" muted>{u.days_active}</Td>
                <Td align="right">{u.questions}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      {data.categories.life_events.length > 0 && (
        <Panel
          title="Life events readers submitted"
          subtitle="From horoscope_life_events - the category the READER chose, not the model."
        >
          <BarList
            rows={data.categories.life_events.map((c) => ({
              label: c.category.replace(/_/g, ' '),
              value: c.count,
              sub: `${c.charts} charts`,
            }))}
            color={SERIES[1]}
          />
        </Panel>
      )}
    </div>
  );
}

'use client';

import { Loader2 } from 'lucide-react';

import { Panel, Pill, StatCard, fmt, fmtDate } from '@/components/ui';
import {
  DURATION_LABELS,
  FAILURE_LABELS,
  PRODUCT_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  formatAmount,
  type CouponDetail as CouponDetailData,
} from '@/lib/coupons';

/**
 * Everything about one coupon: its terms, how it has been used, and the
 * individual redemptions.
 *
 * Two numbers here are easy to confuse and are deliberately shown apart.
 * REDEMPTIONS are people who successfully used the code. ATTEMPTS
 * includes everybody who typed it and was refused - and the refusals are
 * broken down by reason, because "438 redemptions from 1,900 attempts"
 * is a different campaign from "438 from 450", and a pile of
 * `invalid_code` means the code is being mistyped somewhere it was
 * printed.
 */
export function CouponDetail({
  detail,
  loading,
}: {
  detail: CouponDetailData | null;
  loading: boolean;
}) {
  if (loading || !detail) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-faint" />
      </div>
    );
  }

  const { coupon, usage, redemptions } = detail;

  return (
    <div className="space-y-6">
      <Panel title="Terms">
        <dl className="divide-y divide-line">
          <Row label="Code">
            <span className="font-mono text-ink">{coupon.code}</span>
          </Row>
          <Row label="Status">
            <Pill className={STATUS_COLORS[coupon.status]}>
              {STATUS_LABELS[coupon.status]}
            </Pill>
          </Row>
          <Row label="Discount">{coupon.discount_percentage}%</Row>
          <Row label="Eligible products">
            {coupon.eligible_products
              .map((p) => PRODUCT_LABELS[p] ?? p)
              .join(', ')}
          </Row>
          <Row label="Discount duration">
            {DURATION_LABELS[coupon.discount_duration] ?? coupon.discount_duration}
          </Row>
          <Row label="Redeemable">
            {fmtDate(coupon.starts_at)} to {fmtDate(coupon.expires_at)}
          </Row>
          <Row label="Maximum redemptions">
            {coupon.max_redemptions ?? 'Unlimited'}
          </Row>
          {coupon.description && (
            <Row label="Internal note">{coupon.description}</Row>
          )}
          <Row label="Created">{fmt(coupon.created_at)}</Row>
        </dl>
      </Panel>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Redemptions" value={usage.total_redemptions} />
        <StatCard label="Unique customers" value={usage.unique_customers} />
        <StatCard
          label="Remaining"
          value={
            coupon.redemptions_remaining === null
              ? 'Unlimited'
              : coupon.redemptions_remaining
          }
        />
        <StatCard
          label="Discount given"
          value={formatAmount(usage.total_discount_amount)}
          sub="across every redemption"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Redemptions by product">
          <div className="divide-y divide-line">
            {Object.entries(usage.by_product).map(([product, count]) => (
              <div
                key={product}
                className="flex items-center justify-between px-5 py-3.5"
              >
                <p className="text-sm text-ink">
                  {PRODUCT_LABELS[product as keyof typeof PRODUCT_LABELS] ?? product}
                </p>
                <p className="text-sm font-semibold text-ink">{count}</p>
              </div>
            ))}
            {usage.released_redemptions > 0 && (
              <div className="px-5 py-3">
                <p className="text-xs text-faint">
                  {usage.released_redemptions} reservation
                  {usage.released_redemptions === 1 ? '' : 's'} released after a
                  payment that never completed. Those cost the coupon nothing
                  and are not counted above.
                </p>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Attempts">
          <div className="divide-y divide-line">
            <div className="flex items-center justify-between px-5 py-3.5">
              <p className="text-sm text-ink">Total submissions</p>
              <p className="text-sm font-semibold text-ink">{usage.total_attempts}</p>
            </div>
            <div className="flex items-center justify-between px-5 py-3.5">
              <p className="text-sm text-ink">Accepted</p>
              <p className="text-sm font-semibold text-ink">
                {usage.successful_attempts}
              </p>
            </div>
            <div className="flex items-center justify-between px-5 py-3.5">
              <p className="text-sm text-ink">Refused</p>
              <p className="text-sm font-semibold text-ink">
                {usage.failed_attempts}
              </p>
            </div>
            {Object.entries(usage.failures_by_reason).map(([reason, count]) => (
              <div key={reason} className="flex items-start justify-between gap-3 px-5 py-3">
                <p className="text-xs text-faint">
                  {FAILURE_LABELS[reason] ?? reason}
                </p>
                <p className="shrink-0 text-xs font-medium text-muted">{count}</p>
              </div>
            ))}
            {usage.failed_attempts === 0 && (
              <p className="px-5 py-3 text-xs text-faint">
                Nobody has been refused this code.
              </p>
            )}
          </div>
        </Panel>
      </div>

      <Panel title={`Redemption records (${redemptions.length})`}>
        {redemptions.length === 0 ? (
          <p className="px-5 py-6 text-sm text-faint">
            Nobody has redeemed this coupon yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                  <Th>User</Th>
                  <Th>Product</Th>
                  <Th>When</Th>
                  <Th align="right">Original</Th>
                  <Th align="right">Discount</Th>
                  <Th align="right">Paid</Th>
                  <Th>Discount runs to</Th>
                  <Th>State</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {redemptions.map((record) => (
                  <tr key={record.id}>
                    <Td>
                      <span className="font-mono text-xs text-muted">
                        {record.user_id.slice(0, 12)}
                      </span>
                    </Td>
                    <Td>{PRODUCT_LABELS[record.product] ?? record.product}</Td>
                    <Td>{fmt(record.redeemed_at)}</Td>
                    <Td align="right">{formatAmount(record.original_amount)}</Td>
                    <Td align="right">
                      {record.discount_percentage}% (
                      {formatAmount(record.discount_amount)})
                    </Td>
                    <Td align="right">{formatAmount(record.final_amount)}</Td>
                    <Td>
                      {record.discount_end_at
                        ? fmtDate(record.discount_end_at)
                        : DURATION_LABELS[record.discount_duration ?? 'first_purchase']}
                    </Td>
                    <Td>
                      <Pill
                        className={
                          record.status === 'redeemed'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                            : record.status === 'reserved'
                              ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400'
                              : 'bg-raised text-faint'
                        }
                      >
                        {record.status}
                      </Pill>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {usage.active_entitlements > 0 && (
        <p className="text-xs text-faint">
          {usage.active_entitlements} customer
          {usage.active_entitlements === 1 ? ' is' : 's are'} still inside the
          discount this coupon granted. Disabling or archiving the coupon stops
          new redemptions and leaves those running to their own end date.
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-5 py-3">
      <dt className="text-sm text-faint">{label}</dt>
      <dd className="text-right text-sm text-ink">{children}</dd>
    </div>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={`whitespace-nowrap px-4 py-2.5 font-medium ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <td
      className={`whitespace-nowrap px-4 py-3 text-ink ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </td>
  );
}

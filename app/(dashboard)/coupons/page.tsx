'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Ticket,
  XCircle,
} from 'lucide-react';

import { CouponDetail } from '@/components/coupons/CouponDetail';
import { CouponForm } from '@/components/coupons/CouponForm';
import { Panel, Pill, fmtDate } from '@/components/ui';
import { ApiError } from '@/lib/api.client';
import {
  DURATION_LABELS,
  PRODUCT_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  deleteCoupon,
  getCouponDetail,
  getCouponOptions,
  listCoupons,
  setCouponLifecycle,
  type Coupon,
  type CouponDetail as CouponDetailData,
  type CouponOptions,
  type CouponStatus,
} from '@/lib/coupons';

type View =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; coupon: Coupon }
  | { kind: 'detail'; coupon: Coupon };

const FILTERS: (CouponStatus | '')[] = [
  '',
  'active',
  'scheduled',
  'draft',
  'expired',
  'disabled',
  'archived',
];

/**
 * The Coupons section.
 *
 * One screen with three modes rather than three routes: the list, the
 * create / edit form, and the usage detail. An admin pulling a campaign
 * at speed should not lose their filters to a navigation.
 *
 * The rule that shapes most of the controls here: a coupon that has been
 * redeemed is never deleted. Its redemption rows say what a customer was
 * charged and why, and the coupon they point at has to stay to answer
 * for them. Disable stops new redemptions; archive retires it for good;
 * neither touches a discount already granted.
 */
function CouponsScreen() {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [options, setOptions] = useState<CouponOptions | null>(null);
  const [detail, setDetail] = useState<CouponDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [filter, setFilter] = useState<CouponStatus | ''>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  /**
   * Every state update happens in a promise callback rather than in the
   * body of `load`, so the effect below starts the request without
   * setting state synchronously. `loading` therefore starts true and is
   * only ever turned off; the Refresh button turns it back on itself,
   * which is a user event and not an effect.
   */
  const load = useCallback(
    () =>
      listCoupons({
        status: filter || undefined,
        search: search.trim() || undefined,
      })
        .then((data) => {
          setCoupons(data.coupons);
          setError('');
        })
        .catch((e) => {
          if (e instanceof ApiError && e.status === 403) {
            setError('Your account does not have access to coupons.');
          } else if (e instanceof ApiError && e.status === 503) {
            // The 503 names the missing migration, which is exactly what
            // an operator needs to read.
            setError(e.message);
          } else {
            setError(e instanceof Error ? e.message : 'Could not load coupons.');
          }
        })
        .finally(() => setLoading(false)),
    [filter, search],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getCouponOptions()
      .then(setOptions)
      .catch(() => setOptions(null));
  }, []);

  const openDetail = useCallback(async (coupon: Coupon) => {
    setView({ kind: 'detail', coupon });
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await getCouponDetail(coupon.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load that coupon.');
      setView({ kind: 'list' });
    } finally {
      setDetailLoading(false);
    }
  }, []);

  async function changeLifecycle(coupon: Coupon, lifecycle: Coupon['lifecycle']) {
    setBusyId(coupon.id);
    setError('');
    setNotice('');
    try {
      await setCouponLifecycle(coupon.id, lifecycle);
      setNotice(
        lifecycle === 'disabled'
          ? `${coupon.code} is disabled. Nobody new can redeem it; discounts already granted keep running.`
          : lifecycle === 'archived'
            ? `${coupon.code} is archived. Its usage history is intact.`
            : `${coupon.code} is ${lifecycle}.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update that coupon.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(coupon: Coupon) {
    if (
      !window.confirm(
        `Delete ${coupon.code}? This only works while a coupon has never been redeemed.`,
      )
    ) {
      return;
    }
    setBusyId(coupon.id);
    setError('');
    setNotice('');
    try {
      await deleteCoupon(coupon.id);
      setNotice(`${coupon.code} deleted.`);
      await load();
    } catch (e) {
      // The 409 says a redeemed coupon must be archived instead, and
      // that message is worth showing verbatim.
      setError(e instanceof Error ? e.message : 'Could not delete that coupon.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Coupons</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              A coupon controls when a code can be redeemed and for what. What a
              customer gets after redeeming is tracked separately, so retiring a
              campaign never cancels a discount somebody was already given.
            </p>
          </div>
          <button
            onClick={() => {
              setLoading(true);
              load();
            }}
            disabled={loading}
            title="Refresh coupons"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-muted transition-colors hover:bg-raised disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </header>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <p className="rounded-md border border-line bg-raised px-4 py-3 text-sm text-muted">
            {notice}
          </p>
        )}

        {view.kind === 'list' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {FILTERS.map((status) => (
                <button
                  key={status || 'all'}
                  onClick={() => setFilter(status)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    filter === status
                      ? 'bg-solid text-inverse'
                      : 'bg-raised text-muted hover:bg-line'
                  }`}
                >
                  {status === '' ? 'All' : STATUS_LABELS[status]}
                </button>
              ))}

              <div className="relative ml-auto">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search code or note"
                  className="w-52 rounded-md border border-line bg-raised py-1.5 pl-8 pr-3 text-xs text-ink placeholder:text-faint focus:border-faint focus:outline-none focus:ring-1 focus:ring-faint"
                />
              </div>

              <button
                onClick={() => setView({ kind: 'create' })}
                disabled={!options}
                className="inline-flex items-center gap-1.5 rounded-md bg-solid px-3 py-1.5 text-xs font-medium text-inverse transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                New coupon
              </button>
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-faint" />
              </div>
            ) : coupons.length === 0 ? (
              <div className="rounded-lg border border-line bg-surface p-10 text-center text-faint">
                <Ticket className="mx-auto mb-2 h-8 w-8 opacity-40" />
                <p className="text-sm">No coupons here.</p>
              </div>
            ) : (
              <Panel title={`${coupons.length} coupon${coupons.length === 1 ? '' : 's'}`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                        <th className="px-4 py-2.5 font-medium">Code</th>
                        <th className="px-4 py-2.5 font-medium">Discount</th>
                        <th className="px-4 py-2.5 font-medium">Products</th>
                        <th className="px-4 py-2.5 font-medium">Duration</th>
                        <th className="px-4 py-2.5 font-medium">Redeemable</th>
                        <th className="px-4 py-2.5 text-right font-medium">Used</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {coupons.map((coupon) => (
                        <tr key={coupon.id} className="align-top">
                          <td className="px-4 py-3">
                            <button
                              onClick={() => openDetail(coupon)}
                              className="font-mono text-sm text-ink underline-offset-2 hover:underline"
                            >
                              {coupon.code}
                            </button>
                            {coupon.description && (
                              <p className="mt-0.5 max-w-[16rem] truncate text-xs text-faint">
                                {coupon.description}
                              </p>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-ink">
                            {coupon.discount_percentage}%
                          </td>
                          <td className="px-4 py-3 text-muted">
                            {coupon.eligible_products
                              .map((p) => PRODUCT_LABELS[p] ?? p)
                              .join(', ')}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-muted">
                            {DURATION_LABELS[coupon.discount_duration]}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-xs text-muted">
                            {fmtDate(coupon.starts_at)}
                            <br />
                            {fmtDate(coupon.expires_at)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-ink">
                            {coupon.redemption_count}
                            {coupon.max_redemptions !== null && (
                              <span className="text-faint">
                                {' '}
                                / {coupon.max_redemptions}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Pill className={STATUS_COLORS[coupon.status]}>
                              {STATUS_LABELS[coupon.status]}
                            </Pill>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              {busyId === coupon.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-faint" />
                              ) : (
                                <>
                                  <Action onClick={() => setView({ kind: 'edit', coupon })}>
                                    Edit
                                  </Action>
                                  {coupon.lifecycle === 'published' ? (
                                    <Action
                                      onClick={() => changeLifecycle(coupon, 'disabled')}
                                    >
                                      Disable
                                    </Action>
                                  ) : coupon.lifecycle !== 'archived' ? (
                                    <Action
                                      onClick={() => changeLifecycle(coupon, 'published')}
                                    >
                                      Publish
                                    </Action>
                                  ) : null}
                                  {coupon.lifecycle !== 'archived' && (
                                    <Action
                                      onClick={() => changeLifecycle(coupon, 'archived')}
                                    >
                                      Archive
                                    </Action>
                                  )}
                                  {coupon.redemption_count === 0 && (
                                    <Action danger onClick={() => remove(coupon)}>
                                      Delete
                                    </Action>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            )}
          </>
        )}

        {(view.kind === 'create' || view.kind === 'edit') && options && (
          <Panel title={view.kind === 'create' ? 'New coupon' : `Edit ${view.coupon.code}`}>
            <CouponForm
              options={options}
              existing={view.kind === 'edit' ? view.coupon : null}
              onCancel={() => setView({ kind: 'list' })}
              onSaved={(saved) => {
                setNotice(
                  view.kind === 'create'
                    ? `${saved.code} created as ${STATUS_LABELS[saved.status].toLowerCase()}.`
                    : `${saved.code} saved.`,
                );
                setView({ kind: 'list' });
                load();
              }}
            />
          </Panel>
        )}

        {view.kind === 'detail' && (
          <>
            <button
              onClick={() => setView({ kind: 'list' })}
              className="inline-flex items-center gap-1.5 text-xs text-faint transition-colors hover:text-muted"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              All coupons
            </button>
            <CouponDetail detail={detail} loading={detailLoading} />
          </>
        )}
      </div>
    </div>
  );
}

function Action({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
        danger
          ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10'
          : 'text-muted hover:bg-raised'
      }`}
    >
      {children}
    </button>
  );
}

export default function Page() {
  return <CouponsScreen />;
}

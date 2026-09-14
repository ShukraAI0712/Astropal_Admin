'use client';

import {
  createContext, useCallback, useContext, useEffect, useState, type ReactNode,
} from 'react';
import type { Analytics } from './analytics';
import { supabase } from './supabase.client';

/**
 * One analytics document, fetched once and shared by every screen.
 *
 * The provider lives in the dashboard layout, above the router outlet, so
 * moving between Overview, Engagement, Users, Revenue and Reports is a React
 * re-render and not a second request. The only things that refetch are a full
 * page load and the Refresh button, and Refresh is the only caller that asks
 * the server to skip its own cache.
 */

interface AnalyticsState {
  data: Analytics | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  fetchedAt: Date | null;
  refresh: () => void;
}

const AnalyticsContext = createContext<AnalyticsState>({
  data: null,
  loading: true,
  refreshing: false,
  error: '',
  fetchedAt: null,
  refresh: () => {},
});

type Result = { data: Analytics } | { error: string };

/**
 * The network half, deliberately outside the component and holding no state.
 *
 * Keeping the fetch free of setState is what lets the effect below start it
 * without a cascading render: the results arrive in a promise callback, which
 * is the shape React actually wants for "subscribe to an external system".
 */
async function fetchAnalytics(fresh: boolean): Promise<Result> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return { error: 'Not authenticated.' };

    // The browser's own timezone, so a business day means the day the person
    // reading this screen is actually in.
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
    const res = await fetch(
      `/api/analytics?tz=${encodeURIComponent(tz)}${fresh ? '&fresh=1' : ''}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
    );

    const body = await res.json();
    if (!res.ok) return { error: body.error ?? `Request failed (${res.status}).` };

    return { data: body as Analytics };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not load analytics.' };
  }
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  const apply = useCallback((result: Result) => {
    if ('error' in result) {
      setError(result.error);
    } else {
      setError('');
      setData(result.data);
      setFetchedAt(new Date());
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  const load = useCallback(
    (fresh: boolean) => { fetchAnalytics(fresh).then(apply); },
    [apply]
  );

  useEffect(() => { load(false); }, [load]);

  // Refresh is a user event, so the pending state is set straight away - the
  // click owns the spinner, which is why this is not in the effect path.
  const refresh = useCallback(() => {
    setRefreshing(true);
    load(true);
  }, [load]);

  return (
    <AnalyticsContext.Provider
      value={{ data, loading, refreshing, error, fetchedAt, refresh }}
    >
      {children}
    </AnalyticsContext.Provider>
  );
}

export function useAnalytics() {
  return useContext(AnalyticsContext);
}

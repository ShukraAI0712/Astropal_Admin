'use client';

import { Loader2, XCircle } from 'lucide-react';
import { RequireAuth } from '@/components/RequireAuth';
import { Sidebar } from '@/components/shell/Sidebar';
import { AnalyticsProvider, useAnalytics } from '@/lib/analytics-context';

/**
 * The frame every dashboard screen renders inside.
 *
 * The analytics provider sits HERE rather than in each page, which is what
 * makes the sidebar cheap: one document is fetched per visit and every screen
 * reads from it, so navigating the whole dashboard costs one database call.
 */

function Frame({ children }: { children: React.ReactNode }) {
  const { loading, error, data } = useAnalytics();

  return (
    <div className="min-h-screen">
      <Sidebar />
      <main className="lg:pl-60">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-10">
          {error ? (
            <div className="mx-auto max-w-md py-20 text-center">
              <XCircle className="mx-auto h-10 w-10 text-red-500" />
              <p className="mt-4 text-sm text-muted">{error}</p>
            </div>
          ) : loading && !data ? (
            <div className="flex justify-center py-24">
              <Loader2 className="h-7 w-7 animate-spin text-faint" />
            </div>
          ) : (
            children
          )}
        </div>
      </main>
    </div>
  );
}

export default function DashboardLayout({ children }: LayoutProps<'/'>) {
  return (
    <RequireAuth>
      <AnalyticsProvider>
        <Frame>{children}</Frame>
      </AnalyticsProvider>
    </RequireAuth>
  );
}

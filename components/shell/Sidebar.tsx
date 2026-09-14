'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3, LifeBuoy, LogOut, Menu, MessageSquare, RefreshCw,
  Tag, TrendingUp, Users, Wallet, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase.client';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAnalytics } from '@/lib/analytics-context';
import { Pill } from '@/components/ui';

/**
 * The application frame: a fixed sidebar on desktop, a drawer behind a
 * hamburger below `lg`.
 *
 * Every section is a route rather than a tab, so a screen can be linked,
 * bookmarked and reloaded. They share one analytics document held above the
 * router outlet, so moving between them is free.
 */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Overview lives at "/", so it must match exactly or it is always active. */
  end?: boolean;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: BarChart3, end: true },
  { href: '/engagement', label: 'Engagement', icon: MessageSquare },
  { href: '/users', label: 'Users & retention', icon: Users },
  { href: '/revenue', label: 'Revenue', icon: Wallet },
  { href: '/reports', label: 'Reports', icon: TrendingUp },
  { href: '/coupons', label: 'Coupons', icon: Tag },
  { href: '/support', label: 'Support', icon: LifeBuoy },
];

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  staff: 'Staff',
  user: 'User',
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  admin: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  staff: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  user: 'bg-raised text-muted',
};

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data, refresh, refreshing, fetchedAt } = useAnalytics();
  const [open, setOpen] = useState(false);

  // Escape closes it, because a drawer that traps you is worse than no drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  const badges: Record<string, number> = {
    '/support': data?.support.open ?? 0,
    '/reports': data?.reports.queue.failed ?? 0,
  };

  const nav = (
    <nav className="flex-1 space-y-0.5 px-3 py-4">
      {NAV.map((item) => {
        const active = item.end ? pathname === item.href : pathname.startsWith(item.href);
        const badge = badges[item.href] ?? 0;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            // The drawer closes from the click rather than from an effect on
            // the path: leaving it open over the screen you just navigated to
            // is the single most common mobile-nav bug.
            onClick={() => setOpen(false)}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? 'bg-raised text-ink' : 'text-muted hover:bg-raised hover:text-ink'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{item.label}</span>
            {badge > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="space-y-3 border-t border-line px-3 py-4">
      {data && (
        <div className="px-2">
          <Pill className={ROLE_COLORS[data.caller_role] ?? ROLE_COLORS.user}>
            {ROLE_LABELS[data.caller_role] ?? data.caller_role}
          </Pill>
        </div>
      )}
      <div className="flex items-center gap-2 px-1">
        <button
          onClick={refresh}
          disabled={refreshing}
          title="Refresh the numbers"
          className="flex h-9 flex-1 items-center justify-center gap-2 rounded-lg border border-line text-xs font-medium text-muted transition-colors hover:bg-raised disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
        <ThemeToggle />
        <button
          onClick={signOut}
          title="Sign out"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-raised"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
      {fetchedAt && (
        <p className="px-2 text-[11px] text-faint">
          Updated{' '}
          {fetchedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          {data?.cached && data.cache_age_seconds > 0 && ` · ${data.cache_age_seconds}s cache`}
        </p>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile bar */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-muted"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="font-semibold text-ink">AstroPal Admin</span>
        <button
          onClick={refresh}
          disabled={refreshing}
          aria-label="Refresh"
          className="ml-auto flex h-10 w-10 items-center justify-center rounded-lg border border-line text-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <div className="border-b border-line px-5 py-5">
          <p className="text-xs font-medium tracking-wide text-faint uppercase">Internal</p>
          <p className="mt-0.5 text-lg font-semibold text-ink">AstroPal Admin</p>
        </div>
        {nav}
        {footer}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <span className="font-semibold text-ink">AstroPal Admin</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-raised"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {nav}
            {footer}
          </div>
        </div>
      )}
    </>
  );
}

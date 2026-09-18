import { NextResponse, type NextRequest } from 'next/server';

/**
 * A per-request nonce, and the Content-Security-Policy that trusts it.
 *
 * This dashboard renders customer emails and revenue in a browser that also
 * holds a Supabase session in local storage. One injected script is therefore
 * worth both the data on screen and the token that fetches more of it, and
 * until now nothing stood between an injection and either. A CSP is the
 * second line: even given a successful injection, the script has to be one
 * this response vouched for, and it cannot post what it reads to an origin
 * that is not on the list below.
 *
 * `connect-src` is the directive doing the most work here. `'self'` plus
 * Supabase plus the product API is the complete set of places this app ever
 * talks to, so exfiltration to an attacker's collector is refused by the
 * browser rather than merely unlikely.
 *
 * Nonces mean dynamic rendering - Next.js can only stamp a nonce onto the
 * framework's own script tags while it is rendering a real request. Every
 * screen in here is a client component behind an auth gate that fetches on
 * mount, so there was no static output to lose.
 *
 * `'strict-dynamic'` lets the nonced bootstrap load the chunk graph without
 * each chunk URL needing its own allowance, which is what keeps this policy
 * from decaying into `'self'`-with-extra-steps as the app grows.
 */

/**
 * Where the browser is allowed to send fetches. Read from the same public
 * variables the client is built with, so the policy cannot drift from what
 * the app actually calls. Supabase Realtime upgrades to a websocket, hence
 * the `wss:` twin.
 */
function connectSources(): string[] {
  const sources = new Set<string>(["'self'"]);

  for (const raw of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_API_URL]) {
    if (!raw) continue;
    try {
      const { origin, protocol, host } = new URL(raw);
      sources.add(origin);
      if (protocol === 'https:') sources.add(`wss://${host}`);
    } catch {
      // A malformed URL is a deployment mistake, not a reason to widen the
      // policy. It is left out; the request it would have allowed fails
      // visibly in the console instead of silently reaching anywhere.
    }
  }

  return [...sources];
}

export function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const isDev = process.env.NODE_ENV === 'development';

  const csp = [
    "default-src 'self'",
    // 'unsafe-eval' in development only: React uses eval to rebuild
    // server-side error stacks in the browser. Production never needs it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // No `onclick=""` anywhere in this app, and nothing should be able to add
    // one.
    "script-src-attr 'none'",
    // Stylesheets: Tailwind's is a file, and the only <style> elements are the
    // ones Next.js and next/font emit, which Next.js nonces itself. Dev builds
    // inject styles ahead of that machinery, so the strict form is
    // production's.
    `style-src-elem 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    // The `style={{ ... }}` attributes the charts and status dots are built
    // from. A nonce cannot be attached to an attribute, so this is the one
    // directive that has to stay open - and it is the cheap one to leave
    // open: a style attribute executes nothing, and the CSS-as-exfiltration
    // trick needs an outbound request that `img-src` and `connect-src`
    // already refuse.
    "style-src-attr 'unsafe-inline'",
    // The fallback for any style-src-* a browser does not know about.
    `style-src 'self' 'unsafe-inline'${isDev ? '' : ` 'nonce-${nonce}'`}`,
    "img-src 'self' blob: data:",
    // next/font self-hosts Geist at build time, so no font CDN is needed.
    "font-src 'self'",
    `connect-src ${connectSources().join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  // Next.js reads the nonce back off the request's CSP header to stamp its own
  // script tags; `x-nonce` is how the root layout reaches it for the inline
  // theme script it renders itself.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything that renders HTML. Static assets and image optimisation
     * carry no inline script, and prefetches are excluded so a prefetched
     * document does not arrive holding a nonce that its eventual response
     * will not match.
     */
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};

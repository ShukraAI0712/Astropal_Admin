import type { NextConfig } from "next";

/**
 * The headers that do not change per request. The Content-Security-Policy is
 * not here - it carries a per-request nonce and so is set in `proxy.ts`.
 *
 * These are the cheap half of hardening an internal console: none of them
 * needs application code to cooperate, and between them they cover the three
 * things a dashboard full of customer data gets attacked through that no
 * amount of careful React prevents - being framed, being sniffed into a
 * different content type, and being reached over plaintext.
 */
const securityHeaders = [
  // Clickjacking. `frame-ancestors 'none'` in the CSP is the modern form and
  // the one that actually governs; this is for browsers and scanners that
  // still look for the old header.
  { key: "X-Frame-Options", value: "DENY" },

  // Stops a JSON response from being re-interpreted as HTML or script.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Two years of HTTPS-only, so a session token is never carried over a
  // plaintext hop. Vercel terminates TLS for this app; the header makes the
  // browser refuse to try anything else in the first place.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },

  // Full URLs stay inside the origin. The paths in here name internal
  // screens, and there is no reason for a third party to learn them.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // This app asks for none of these. Saying so means a future dependency
  // cannot quietly start asking either.
  {
    key: "Permissions-Policy",
    value:
      "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=()",
  },

  // Severs the window.opener relationship, so nothing this page opens - or
  // that opens this page - can reach into its window object.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },

  // Hostnames in this document are not resolved ahead of being needed, which
  // would otherwise leak where the dashboard talks to onto the network.
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  // The framework and its version are not the attacker's business.
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

import type { NextConfig } from 'next';

// The browser only ever talks to the web origin. /v1/* is proxied to the API so the session cookie
// (fl_session, SameSite=Lax, httpOnly) stays first-party. Override the target at build time with
// API_PROXY_TARGET for other environments.
const apiProxyTarget = (process.env.API_PROXY_TARGET ?? 'http://localhost:4000').replace(/\/$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages ship TypeScript source (docs/adr/0001).
  transpilePackages: [
    '@fieldline/contracts',
    '@fieldline/ui',
    '@fieldline/pricing',
    '@fieldline/geometry',
    '@fieldline/pdf',
  ],
  async redirects() {
    // /home is a friendly alias; the route registry's Home is "/" (PLT-011 D).
    return [{ source: '/home', destination: '/', permanent: true }];
  },
  async rewrites() {
    return [{ source: '/v1/:path*', destination: `${apiProxyTarget}/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        // The service worker must always be revalidated so fixes reach installed apps promptly.
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;

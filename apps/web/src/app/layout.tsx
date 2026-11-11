import '@fieldline/ui/styles.css';
import './globals.css';
import './command-center.css';
import { BRAND } from '@fieldline/contracts';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s | ${BRAND.name}` },
  description: BRAND.description,
  applicationName: BRAND.name,
  appleWebApp: { capable: true, title: BRAND.shortName, statusBarStyle: 'black-translucent' },
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches the command-center background (command-center.css) and theme_color in manifest.ts.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#050a12' },
    { media: '(prefers-color-scheme: dark)', color: '#050a12' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className="cc-theme">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

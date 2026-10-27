import { BRAND } from '@fieldline/contracts';
import type { MetadataRoute } from 'next';

// Installable PWA manifest (phone home screen, desktop install). Served at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: BRAND.name,
    short_name: BRAND.shortName,
    description: BRAND.description,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f6f7f4',
    theme_color: '#0f5b5c',
    categories: ['business', 'productivity', 'utilities'],
    // Both products as equal home-screen shortcuts (PLT-011 A).
    shortcuts: [
      {
        name: BRAND.products.roof,
        short_name: 'Roof',
        url: '/roof',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: BRAND.products.curb,
        short_name: 'Curb',
        url: '/curb',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}

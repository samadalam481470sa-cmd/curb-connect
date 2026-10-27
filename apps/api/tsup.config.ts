import { defineConfig } from 'tsup';

// Production bundle. Workspace packages (@fieldline/*) ship as TypeScript source, so they are
// bundled in; everything resolved from node_modules stays external and is installed with
// `npm ci --omit=dev --workspace @fieldline/api` on the target. See docs/adr/0001.
export default defineConfig({
  entry: {
    main: 'src/main.ts',
    migrate: 'src/db/migrate.ts',
    seed: 'src/db/seed.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  skipNodeModulesBundle: true,
  noExternal: [/^@fieldline\//],
});

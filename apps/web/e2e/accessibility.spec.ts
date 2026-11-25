import axe from 'axe-core';
import { expect, test } from '@playwright/test';

// Browser-based WCAG checks complement, rather than replace, keyboard and screen-reader testing.
// Unlike jsdom, this runs real browser layout/contrast rules against public entry flows.
const routes = ['/sign-in?choose=1', '/sign-up', '/legal/privacy', '/legal/accessibility'];

for (const route of routes) {
  test(`public page ${route} has no serious or critical WCAG violations`, async ({ page }) => {
    await page.goto(route);
    await page.addScriptTag({ content: axe.source });
    const violations = await page.evaluate(async () => {
      const axeEngine = (window as typeof window & { axe?: typeof axe }).axe;
      if (!axeEngine) throw new Error('axe-core failed to load');
      const audit = await axeEngine.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        },
      });
      return audit.violations
        .filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))
        .map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.map((node) => node.target),
        }));
    });
    expect(violations, `WCAG violations on ${route}`).toEqual([]);
  });
}

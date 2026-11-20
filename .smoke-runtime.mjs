// Runtime smoke: signs in through the real dev flow, visits every web route, records problems.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const OUT = 'C:/Users/perve/AppData/Local/Temp/sectest/smoke';
const BASE = 'http://localhost:3000';
const appRoutes = process.argv[2] ? process.argv[2].split(',') : ['/', '/home', '/bidding', '/billing', '/billing/bills', '/build', '/build/projects', '/curb', '/enterprise', '/enterprise/bim', '/enterprise/controls', '/enterprise/costing', '/enterprise/field', '/enterprise/takeoff', '/enterprise/vault', '/invoice-dashboard', '/jobs', '/lawn', '/leads', '/network', '/plumbing', '/proposals', '/reports', '/roof', '/search', '/settings', '/settings/connectors', '/settings/email', '/settings/notifications', '/settings/price-books', '/subscription', '/team'];
const publicRoutes = ['/sign-in?choose=1', '/sign-up', '/legal', '/legal/accessibility', '/legal/cookies', '/legal/data-sources', '/legal/disclaimer', '/legal/privacy', '/legal/terms', '/offline', '/track', '/verify-email', '/access', '/onboarding', '/select-workspace', '/invite/not-a-real-token'];
async function visit(context, route, signedIn) {
  const page = await context.newPage();
  const rec = { route, signedIn, consoleErrors: [], pageErrors: [], badResponses: [], failedRequests: [] };
  page.on('console', (m) => { if (m.type() === 'error') rec.consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => rec.pageErrors.push(String(e.message).slice(0, 300)));
  page.on('response', (r) => { const u = r.url(); if (r.status() >= 400 && !u.includes('/_next/static') && !u.endsWith('favicon.ico')) rec.badResponses.push(`${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`.slice(0, 200)); });
  page.on('requestfailed', (r) => { const f = r.failure()?.errorText ?? ''; if (!f.includes('ERR_ABORTED')) rec.failedRequests.push(`${f} ${r.url().replace(BASE, '')}`.slice(0, 200)); });
  try {
    const resp = await page.goto(BASE + route, { waitUntil: 'load', timeout: 90_000 });
    rec.status = resp?.status() ?? null;
    await page.waitForTimeout(3500);
    rec.finalUrl = page.url().replace(BASE, '');
    rec.title = await page.title();
    rec.h1 = (await page.locator('h1').first().textContent({ timeout: 2000 }).catch(() => null))?.trim().slice(0, 80) ?? null;
    rec.errorOverlay = (await page.locator('nextjs-portal').count()) > 0;
    const body = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).slice(0, 4000);
    rec.errorText = /something went wrong|application error|unhandled runtime error|could not load|failed to load|internal server error/i.exec(body)?.[0] ?? null;
    const shot = route.replace(/[^a-z0-9]+/gi, '_') || 'root';
    await page.screenshot({ path: `${OUT}/${signedIn ? 'app' : 'pub'}${shot}.png`, fullPage: false });
    rec.screenshot = `${OUT}/${signedIn ? 'app' : 'pub'}${shot}.png`;
  } catch (e) { rec.navError = String(e.message).slice(0, 300); }
  await page.close();
  return rec;
}
const browser = await chromium.launch({ headless: true });
const results = [];
const signedIn = await browser.newContext({ viewport: { width: 1366, height: 900 } });
{ const p = await signedIn.newPage(); await p.goto(BASE + '/', { waitUntil: 'load', timeout: 120_000 }); await p.waitForTimeout(6000); results.push({ route: '(sign-in bootstrap)', finalUrl: p.url().replace(BASE, '') }); await p.close(); }
for (const r of appRoutes) results.push(await visit(signedIn, r, true));
if (!process.argv[2]) { const anon = await browser.newContext({ viewport: { width: 1366, height: 900 } }); for (const r of publicRoutes) results.push(await visit(anon, r, false)); }
await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
for (const r of results) {
  const issues = [r.navError && 'NAV:' + r.navError, r.errorOverlay && 'OVERLAY', r.errorText && 'TEXT:' + r.errorText, r.pageErrors?.length && 'PAGEERR:' + r.pageErrors.length, r.consoleErrors?.length && 'CONSOLE:' + r.consoleErrors.length, r.badResponses?.length && 'HTTP:' + r.badResponses.length, r.failedRequests?.length && 'NET:' + r.failedRequests.length].filter(Boolean);
  console.log(`${(r.signedIn === false ? 'pub ' : 'app ')}${r.route.padEnd(26)} -> ${String(r.finalUrl ?? '').padEnd(26)} ${r.status ?? ''} ${issues.join(' ')}`);
}

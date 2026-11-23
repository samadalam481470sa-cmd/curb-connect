// Built-in help topics for Ask Field Pro (Phase F item 28). These are short, repo-maintained
// answers that work with no AI connected: when no model is reachable the Ask panel searches this
// catalog instead of inventing an answer. Keep every topic true to what the app actually does —
// gated features say so plainly.
import type { AssistantHelpTopic } from '@fieldline/contracts';

export const HELP_TOPICS: readonly AssistantHelpTopic[] = [
  {
    id: 'trial',
    title: 'How the free trial works',
    tool: 'subscription',
    body: 'A new company gets a 7-day free trial. While the trial is running every tool is open. When it ends, product screens pause until a paid plan is active, but the Billing screen stays reachable so you can subscribe. One trial per person and per email address.',
    keywords: ['trial', 'free', '7 days', 'expired', 'day 8', 'subscribe', 'plan'],
  },
  {
    id: 'password-reset',
    title: 'Reset a forgotten password',
    tool: 'general',
    body: 'Use "Forgot password" on the sign-in screen. The reset link is emailed and expires after one hour; it can be used once. If the app says email is not configured, the link cannot be sent yet — an admin must finish the mail setup first. Signing in with Microsoft or Google does not need a Field Pro password.',
    keywords: ['password', 'forgot', 'reset', 'sign in', 'login', 'locked out'],
  },
  {
    id: 'invoice-send-vs-email',
    title: 'Sending an invoice vs emailing it',
    tool: 'invoices',
    body: 'Send issues the invoice (draft becomes issued). Emailing is a separate step that sends the PDF from your connected Gmail or Outlook once a mailbox is connected in Settings → Email. If no mailbox is connected, the invoice is still issued and can be downloaded as a PDF to send your own way.',
    keywords: ['invoice', 'send', 'email', 'gmail', 'outlook', 'pdf', 'issued'],
  },
  {
    id: 'material-prices',
    title: 'Material prices and the price book',
    tool: 'estimates',
    body: 'Your price book holds your own prices and always works. Live store listings appear only when a price source is connected on the server; the screen shows the source and when it was checked. A blank price means "not priced yet" — Field Pro never invents a price for you.',
    keywords: ['price', 'material', 'supplier', 'live', 'price book', 'cost'],
  },
  {
    id: 'supplier-orders-off',
    title: 'Supplier ordering is switched off',
    tool: 'supplierOrders',
    body: 'Supplier ordering is built but stays switched off until it is checked with a real supplier. While it is off the screen shows as unavailable and no order can be placed. Use your price book and your usual supplier in the meantime.',
    keywords: ['supplier', 'order', 'ordering', 'unavailable', 'off'],
  },
  {
    id: 'permit-rules-off',
    title: 'City permit rule checks are switched off',
    tool: 'curb',
    body: 'Permit rule checks stay switched off until each city\'s rules are verified. The Permit Center still links to each city\'s official portal. Always confirm requirements with the city building office before you pull a permit.',
    keywords: ['permit', 'rules', 'city', 'code', 'inspection', 'off'],
  },
  {
    id: 'hvac-electrical-estimators',
    title: 'HVAC and electrical estimators',
    tool: 'hvac',
    body: 'These are planning estimators. They turn your inputs into quantities using assumptions you can edit (for example square feet per ton). They are not a Manual J load calculation and not an NEC Article 220 load calculation — a licensed trade must size the real system. Prices come from your price book only.',
    keywords: ['hvac', 'electrical', 'estimator', 'ton', 'load', 'panel', 'manual j', 'nec'],
  },
  {
    id: 'roof-inspection',
    title: 'Photo inspection report',
    tool: 'roof',
    body: 'Open Roof → Photo inspection report. Add roof photos, tap to place numbered markers, and record each finding (missing shingles, creased tabs, lifted flashing, and more) with a severity and pass/monitor/fail. The report prints as a branded PDF. A finding with no price is shown as "Price missing" and the report is not final until it is priced.',
    keywords: ['roof', 'inspection', 'photo', 'report', 'findings', 'pass', 'fail'],
  },
  {
    id: 'permit-leads',
    title: 'Permit Job Search and Leads',
    tool: 'permit-jobs',
    body: 'Permit Job Search pulls live public permit data for covered Texas cities and ranks likely jobs by trade. The Builder Book groups permits by company, and Roof-age leads list properties whose newest roofing permit is older than the age you pick (15 years by default). Permit data can lag or miss work — verify in person before quoting.',
    keywords: ['permit', 'leads', 'jobs', 'builder book', 'roof age', 'texas'],
  },
  {
    id: 'project-management',
    title: 'Project Management: RFIs, schedules, daily logs',
    tool: 'projectManagement',
    body: 'Project Management keeps RFIs and submittals (numbered, with due dates), Gantt schedules, daily logs, drawing versions with pin markups, punch lists and checklists, change orders, crew scheduling and a fleet registry. Daily-log weather is typed in by hand, fleet locations are manual check-ins, and change-order signing is a typed-name attestation recorded with a document hash.',
    keywords: ['rfi', 'submittal', 'gantt', 'schedule', 'daily log', 'punch', 'change order', 'crew', 'fleet'],
  },
  {
    id: 'house-builder',
    title: 'House Builder and Land feasibility',
    tool: 'build',
    body: 'House Builder estimates a build from your plan inputs and price book. Land feasibility adds terrain from USGS elevation data and flood-zone checks, then models layout, earthwork and exit plans (sell, hold, refinance). Zoning and cost starting values are labeled in the tool — confirm them for your lot before you rely on the numbers.',
    keywords: ['house', 'build', 'land', 'feasibility', 'lot', 'terrain', 'flood', 'zoning'],
  },
  {
    id: 'ask-ai-offline',
    title: 'When Ask Field Pro has no AI connected',
    tool: 'assistant',
    body: 'Ask Field Pro answers through the always-on home AI server, with a backup model if one is set up. When neither is connected, no answer is invented — you get these help topics instead. AI answers can be wrong; confirm prices, codes and anything about safety with a licensed professional and your local building office.',
    keywords: ['ask', 'ai', 'assistant', 'offline', 'not connected', 'help'],
  },
  {
    id: 'billing-stripe',
    title: 'Subscribing after the trial',
    tool: 'billing',
    body: 'Open Billing to see your plan, price and renewal terms. Checkout opens only when card payments are set up on the server; until then the screen says so plainly and no charge can be made. Your trial access runs while the trial end time is still ahead.',
    keywords: ['billing', 'stripe', 'subscribe', 'checkout', 'card', 'payment', 'plan'],
  },
  {
    id: 'find-things',
    title: 'Finding things in Field Pro',
    tool: 'search',
    body: 'Use Search to find customers, jobs, estimates, invoices and projects by name or number. Customers and leads live under their own screens; jobs hold the timeline and stage; invoices live in the Invoice Dashboard; permits and bidding have their own hubs. If a screen says a feature is unavailable, it is switched off or not connected yet — the message says which.',
    keywords: ['find', 'search', 'where', 'customers', 'jobs', 'invoices', 'screen'],
  },
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
}

/**
 * Ranks help topics for a query (and optionally the tool the reader is in). Pure and
 * deterministic: keyword hits weigh most, then title, then body; same-tool topics get a boost.
 * An empty query returns the same-tool topics first, then the rest, so the panel always has
 * something honest to show.
 */
export function searchHelp(
  query: string,
  tool?: string,
  topics: readonly AssistantHelpTopic[] = HELP_TOPICS,
  limit = 5,
): AssistantHelpTopic[] {
  const words = normalize(query).split(/\s+/).filter((w) => w.length > 1);
  const scored = topics.map((topic) => {
    let score = 0;
    if (tool && topic.tool === tool) score += 3;
    const title = normalize(topic.title);
    const body = normalize(topic.body);
    const keys = topic.keywords.map(normalize);
    for (const word of words) {
      if (keys.some((k) => k.includes(word) || word.includes(k))) score += 4;
      if (title.includes(word)) score += 2;
      if (body.includes(word)) score += 1;
    }
    return { topic, score };
  });
  return scored
    .filter((s) => words.length === 0 || s.score > 0)
    .sort((a, b) => b.score - a.score || a.topic.title.localeCompare(b.topic.title))
    .slice(0, limit)
    .map((s) => s.topic);
}

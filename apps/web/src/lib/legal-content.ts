/**
 * Legal and policy content. Written from what the product actually does today, so no statement here
 * claims a capability the code does not have. Every document carries the review notice below until
 * owner decision D-13 (legal sign-off) closes; that notice is part of the page on purpose.
 */
export const LEGAL_UPDATED = '19 November 2026';

export const LEGAL_REVIEW_NOTICE =
  'Draft for legal review. This page is written by the engineering team from the behaviour of the ' +
  'product as built, and it is not a substitute for review by qualified counsel (tracked as owner ' +
  'decision D-13). Wording may change before a public launch.';

export interface LegalSection {
  readonly heading: string;
  readonly paragraphs?: readonly string[];
  readonly bullets?: readonly string[];
}

export interface LegalDoc {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly LegalSection[];
}

const privacy: LegalDoc = {
  slug: 'privacy',
  title: 'Privacy policy',
  summary:
    'What Field Pro stores, why, where it is held, how long it is kept and how to exercise your rights.',
  sections: [
    {
      heading: 'Scope',
      paragraphs: [
        'Field Pro is business software for contractors. Companies (workspaces) use it to record properties, measurements, photographs, estimates, proposals and invoices. This policy covers the web application, the mobile web app and the API.',
        'Where a company uses Field Pro to process information about its own customers, that company decides what is collected and why. Field Pro acts as its processor, and requests about that data should go to the company first.',
      ],
    },
    {
      heading: 'What is collected',
      bullets: [
        'Account identity from the sign-in provider: subject identifier, email address, display name and, when the provider supplies it, a profile picture URL.',
        'Workspace membership: company, role, invitation status and the timestamps of changes.',
        'Business records your company enters: properties and addresses, structures, roof and curb measurements, photographs and documents you upload, projects, estimates, proposals, invoices and payments recorded against them.',
        'Technical records needed to operate the service: audit events (who changed what, when, with a correlation id), session records, sign-in timestamps and request logs. Logs are designed not to contain tenant content.',
        'Device-side data: drafts and queued uploads kept in your browser while offline, and a service-worker cache of application files. These stay on your device until they sync or you clear site data.',
      ],
    },
    {
      heading: 'Cookies and local storage',
      paragraphs: [
        'The application sets only the cookies needed to keep you signed in and to protect requests against cross-site forgery. There are no advertising cookies and no third-party analytics scripts. On-device storage holds offline drafts, interface preferences and the application cache.',
        'See the cookie notice for the full list and how to clear it.',
      ],
    },
    {
      heading: 'Why it is processed',
      bullets: [
        'To authenticate you and enforce your company’s permissions.',
        'To store and display the records your company creates, and to keep an auditable history of financial and measurement changes.',
        'To produce the documents you request, such as measurement reports and proposal PDFs.',
        'To operate, secure and support the service: diagnosing faults, preventing abuse and investigating incidents.',
      ],
    },
    {
      heading: 'Where it is held and who else sees it',
      paragraphs: [
        'Records are held in a PostgreSQL database with row-level security, so a company can only read its own rows, and uploaded files are held in object storage. Every table that belongs to a company carries the company identifier and is protected by database policy, not only by application code.',
        'No third-party processors are configured in this build: there is no email delivery vendor, no payment processor, no product analytics vendor and no imagery provider. When any of these are added they will be named here, with the data they receive, before the feature is enabled for customers.',
      ],
    },
    {
      heading: 'Retention',
      paragraphs: [
        'Business records are kept for as long as the company’s workspace exists, because they are the company’s book of record. Signed proposals, issued reports and payment records are immutable revisions and are retained as evidence.',
        'Sessions expire on an idle timeout. Queued offline data is removed from a device once it syncs, and the application cache can be cleared at any time from the browser.',
      ],
    },
    {
      heading: 'Your rights',
      paragraphs: [
        'Depending on where you live you may have the right to access, correct, export, delete or restrict the processing of your personal information, and to object to certain processing. Company administrators can export and correct most records directly in the product; requests that need our help should go to the workspace owner or administrator who invited you, who can raise them with us.',
        'We verify requests before acting on them, and we keep a record of the request and the action taken. Deleting a record does not remove entries that the company must keep as financial or audit evidence until their retention period ends.',
      ],
    },
    {
      heading: 'Security',
      paragraphs: [
        'Sign-in uses OpenID Connect with PKCE, sessions are stored server-side, and permissions are checked on the server for every request. Uploaded images are stored encrypted and attachment downloads are authorised per request rather than served from public links. Security-relevant actions are written to an audit log.',
        'No system is perfectly secure. If you believe an account or workspace has been compromised, contact the workspace owner immediately.',
      ],
    },
    {
      heading: 'Children and changes',
      paragraphs: [
        'The service is for business use and is not directed at children. Material changes to this policy will be published on this page with a new date, and significant changes will be announced in the application before they take effect.',
      ],
    },
  ],
};

const terms: LegalDoc = {
  slug: 'terms',
  title: 'Terms of service',
  summary:
    'The agreement for using Field Pro, what the measurements and estimates do and do not promise, and the limits of our responsibility.',
  sections: [
    {
      heading: 'Acceptance',
      paragraphs: [
        'By signing in or using Field Pro you agree to these terms on behalf of yourself and the company whose workspace you access. If you do not have authority to bind that company, do not use the service.',
        'These terms work together with any signed order form or master agreement between your company and us. If they conflict, the signed agreement wins.',
      ],
    },
    {
      heading: 'Accounts and access',
      bullets: [
        'You are responsible for the accuracy of the identity you sign in with and for keeping that account secure.',
        'Company owners and administrators decide who belongs to a workspace and what each role may do. Removing a member ends their access to that company’s records, not to their own account.',
        'You must not share accounts, attempt to reach another company’s records, or use the service to break the law.',
      ],
    },
    {
      heading: 'Measurements, estimates and professional judgement',
      paragraphs: [
        'Field Pro calculates from the information you supply: addresses, traced geometry, pitches, photographs, calibration references and price books. Its output is a calculation aid for a qualified contractor, not a survey, engineering opinion or certification.',
        'Areas, quantities and prices are only as good as their inputs, and the product is designed to say so: an unknown pitch, an unresolved jurisdiction or a missing price produces an explicit unknown or a review flag instead of a default value. Treat any result marked low confidence, unknown or preliminary as requiring field verification.',
        'Photographs and satellite or aerial imagery cannot establish what is buried, the thickness or reinforcement of concrete, or whether work is authorised. Utility locations, permits, structural adequacy and safe access must be confirmed independently before work starts. Accessibility and code requirements, including the Americans with Disabilities Act and local accessibility rules, are the responsibility of the qualified professional directing the work; the product flags when review is needed and does not certify compliance.',
        'Automated analysis is optional and abstains when it cannot support a conclusion. Any suggestion it produces is a proposal you must review and accept before it becomes part of a measurement.',
      ],
    },
    {
      heading: 'Your content',
      paragraphs: [
        'You keep ownership of the records, photographs and documents your company uploads. You grant us the limited licence needed to store, process, back up and display them so we can run the service for you, and to produce documents you request.',
        'You confirm you have the right to upload what you upload, including any imagery, plans or customer information, and that your use of it complies with the terms of whoever supplied it.',
      ],
    },
    {
      heading: 'Fees',
      paragraphs: [
        'No paid plan is active in this build and no payment is taken. Billing is not implemented, so nothing in the product can charge a card. When paid plans become available, prices, billing periods, taxes and cancellation terms will be agreed in an order form before any charge is made.',
      ],
    },
    {
      heading: 'Availability, changes and termination',
      paragraphs: [
        'The service is under active development. Features may be added, changed or marked unavailable while they are built and verified; the product shows an explicit unavailable state rather than simulated data.',
        'You may stop using the service at any time, and a company owner may request closure of its workspace. We may suspend access to protect the service, other customers or the law. On closure, records are handled as described in the privacy policy.',
      ],
    },
    {
      heading: 'Liability',
      paragraphs: [
        'To the extent the law allows, we are not liable for indirect or consequential loss, lost profit, or loss arising from a construction, pricing or scheduling decision you make using the product. Nothing in these terms limits liability that cannot lawfully be limited.',
        'Our total liability is governed by the signed agreement between your company and us. If there is no signed agreement, it is limited to the amount your company paid us in the twelve months before the event.',
      ],
    },
    {
      heading: 'Governing law and contact',
      paragraphs: [
        'The governing law and venue are those stated in the signed order form or master agreement. Questions about these terms should go to the workspace owner or administrator who invited you, who can raise them with us.',
      ],
    },
  ],
};

const cookies: LegalDoc = {
  slug: 'cookies',
  title: 'Cookie notice',
  summary:
    'The small number of cookies this application sets, what each one does, and how to remove them.',
  sections: [
    {
      heading: 'In short',
      paragraphs: [
        'Field Pro sets strictly necessary cookies only. There is no advertising cookie, no cross-site tracking pixel and no third-party analytics script. Because nothing here is used for tracking or advertising, the application does not show a consent banner: there is nothing optional to consent to.',
      ],
    },
    {
      heading: 'Cookies we set',
      bullets: [
        'Session cookie, set by the API at sign-in: identifies your server-side session so you stay signed in. It is HttpOnly, SameSite-restricted and Secure over HTTPS, and it expires when the session reaches its idle timeout or is signed out.',
        'Request-protection cookie: carries the token that lets the server reject cross-site form submissions. It is required for the sign-in and mutation requests to work.',
        'Workspace preference: remembers which company you last worked in so the next visit opens the right one. It contains an identifier, not business data.',
      ],
    },
    {
      heading: 'Local storage instead of cookies',
      paragraphs: [
        'Offline drafts, queued uploads and interface preferences are kept in the browser’s local storage and IndexedDB rather than sent to us on every request. Application files are cached by a service worker so the app can open without a connection. None of this is shared with third parties.',
      ],
    },
    {
      heading: 'Analytics',
      paragraphs: [
        'Product measurement in this build is a local event dispatched inside the page, carrying a route identifier only. No vendor receives it, and it never contains names, addresses, prices or other company content. If an analytics service is ever added, it will be listed here and made opt-in where the law requires consent.',
      ],
    },
    {
      heading: 'Removing them',
      paragraphs: [
        'Signing out clears the session. Clearing site data in your browser removes cookies, drafts and the application cache; unsynced drafts on that device are lost, so sync before clearing if you have work queued offline.',
      ],
    },
  ],
};

const accessibility: LegalDoc = {
  slug: 'accessibility',
  title: 'Accessibility statement',
  summary:
    'Our conformance target, what has been tested, what is not yet done, and how to report a barrier.',
  sections: [
    {
      heading: 'Our commitment',
      paragraphs: [
        'Field Pro is used by people working in offices, trucks and on job sites, often one-handed, in bright sunlight or with a screen reader. We aim to meet Web Content Accessibility Guidelines (WCAG) 2.2 Level AA, the level commonly used to meet the effective-communication expectations of the Americans with Disabilities Act (ADA) for web applications.',
        'This statement describes the product as it exists today. It is deliberately specific about what has and has not been verified.',
      ],
    },
    {
      heading: 'What is built in',
      bullets: [
        'Every page has one main landmark, a skip link to it, and headings in order; client-side navigation moves focus to the new page heading and announces the page name.',
        'All interactive controls are reachable and operable by keyboard, with a visible focus ring, and icon-only buttons carry an accessible name.',
        'Form fields are programmatically labelled, and hints and errors are associated with the field they describe and announced when they appear.',
        'Status messages, loading states and errors are announced through live regions; nothing important is conveyed by colour alone.',
        'Targets are at least 44 by 44 CSS pixels, the layout reflows on narrow screens, and the interface respects the operating system’s reduce-motion setting.',
        'Text and interface colour pairs are checked against WCAG 2.2 AA contrast in both light and dark themes by an automated test that fails the build if a pair drops below its minimum.',
      ],
    },
    {
      heading: 'How it is tested',
      bullets: [
        'Automated contrast tests over every declared colour pair used by components, in both themes.',
        'Automated accessibility (axe-core) checks on the policy pages and the design system’s interactive primitives, run as part of the test suite.',
        'Keyboard and screen-reader walkthroughs of the sign-in, workspace selection, team administration and settings flows.',
      ],
    },
    {
      heading: 'Known limitations',
      bullets: [
        'No independent third-party accessibility audit or conformance certification has been carried out.',
        'The automated axe-core checks do not yet run against every screen on every build; coverage is being extended as screens are completed.',
        'The roof drawing canvas and the curb photo-capture screens are not built yet. Anything that depends on a map or canvas will need a keyboard-operable alternative before it ships, and none is claimed here.',
        'Generated PDF reports are not tagged PDFs and do not yet claim PDF/UA conformance. The same information is available in the application as HTML.',
        'No formal service-level commitment for accessibility fixes has been agreed; remediation is handled with the same priority as other defects of the same severity.',
      ],
    },
    {
      heading: 'Reporting a barrier',
      paragraphs: [
        'If something blocks you, tell the workspace owner or administrator who invited you, including the page, what you were trying to do and the assistive technology you used. Reports are logged as defects with an accessibility label, and we will confirm what we found and what we changed.',
        'If you need a document or workflow in a different format to do your job, ask for it and we will provide an accessible alternative where we can.',
      ],
    },
    {
      heading: 'Standards and review',
      paragraphs: [
        'This statement is reviewed whenever a major screen is added or an audit is completed, and at least annually. The date below is the last review, not a certification date.',
      ],
    },
  ],
};

export const LEGAL_DOCS: readonly LegalDoc[] = [privacy, terms, cookies, accessibility];

export const LEGAL_DOC_BY_SLUG: Readonly<Record<string, LegalDoc>> = Object.fromEntries(
  LEGAL_DOCS.map((doc) => [doc.slug, doc]),
);

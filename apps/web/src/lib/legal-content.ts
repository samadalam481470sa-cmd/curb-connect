import { LEGAL } from '@fieldline/contracts';

/**
 * Legal and policy content. Written from what the product actually does today, so no statement here
 * claims a capability the code does not have. Every document carries the review notice below until
 * owner decision D-13 (legal sign-off) closes; that notice is part of the page on purpose.
 */
export const LEGAL_UPDATED = '24 November 2026';

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
        'Public-record lead information shown to your company in Permit Job Search, the Active Permits Funnel and Land Scout: owner names, mailing addresses and, where a permit or appraisal district publishes one, phone numbers. See “Public-record lead data” below.',
        'Technical records needed to operate the service: audit events (who changed what, when, with a correlation id), session records, sign-in timestamps and request logs. Logs are designed not to contain tenant content.',
        'Device-side data: drafts and queued uploads kept in your browser while offline, and a service-worker cache of application files. These stay on your device until they sync or you clear site data.',
      ],
    },
    {
      heading: 'Public-record lead data',
      paragraphs: [
        'Permit Job Search, the Active Permits Funnel and Land Scout show information that cities and county appraisal districts already publish: the owner name and mailing address for a property, and a phone number only where the permit record or the appraisal district publishes one. The sources are the city permit feeds listed in Permit Job Search and the Collin and Dallas county appraisal districts. Every lead states where its owner information came from, and Dallas appraisal data is labelled with its 2019 vintage.',
        'This information is public-record data, not data the owner gave us. A property owner who wants their name, mailing address or phone number removed from Field Pro lead lists can ask us at ' +
          LEGAL.contactEmail +
          ' — include the property address and what should be removed. We verify the request and remove the information from the lead lists we show; we cannot remove it from the city or county source records, which remain public.',
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
        'Third-party processors in use: Stripe, the payment processor — when you check out, Stripe receives your email address and the plan price, and card details are entered on Stripe’s pages; we never see or store a full card number. The roof map loads satellite imagery from Esri, and address searches are sent to OpenStreetMap’s Nominatim service; those providers receive your IP address and the map area or address you look up. The workspace and its database are hosted on Render. Email delivery is not connected yet: no email vendor receives data today, and none will be used until it is named here. There is no product analytics vendor.',
      ],
    },
    {
      heading: 'Retention',
      paragraphs: [
        'Business records are kept for as long as the company’s workspace exists, because they are the company’s book of record. Signed proposals, issued reports and payment records are immutable revisions and are retained as evidence. When a workspace closes, account and job data is deleted within 90 days, except records that must be kept for tax, legal or dispute reasons; purchase records are kept for 7 years for tax purposes.',
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
        'If we discover a breach that affects your information, we follow the Field Pro data breach plan (docs/data-breach-plan.md): we assess what happened within 72 hours, and we notify affected users without unreasonable delay — by email and by a notice in the application — telling them what happened, what information was involved and what to do. Where the law requires it, we also notify the relevant regulator.',
      ],
    },
    {
      heading: 'Children and changes',
      paragraphs: [
        'The service is for business use by adults aged 18 or older and is not directed at children. We do not knowingly collect information from anyone under 13; if we learn that we have, we delete it. Material changes to this policy will be published on this page with a new date, and significant changes will be announced in the application before they take effect.',
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
        'New companies get a 7-day free trial. No card is charged during the trial, and a trial that is not followed by a subscription simply ends; your data is kept and comes back as soon as access is restored.',
        'After the trial, access is by subscription. The price and billing period are the ones shown on the Subscribe screen when you check out — the plan price is set in the product, not in these terms, so the price at checkout is the price you pay. Your subscription renews automatically at the end of each billing period until you cancel. Taxes may apply.',
        'Payment is handled by Stripe. Card details are entered on Stripe’s pages; we never see or store a full card number.',
        'To cancel, email ' +
          LEGAL.contactEmail +
          ' before your next renewal date. Your subscription stays active until the end of the billing period you have already paid for. See the Refund Policy for the 30-day refund terms.',
      ],
    },
    {
      heading: 'Refunds',
      paragraphs: [
        'If you do not like Field Pro, email ' +
          LEGAL.contactEmail +
          ' within 30 days of your first payment and we will refund you in full, back to your original payment method. After 30 days, subscriptions are non-refundable, but you can cancel at any time and keep access until the end of your paid period. The full terms are in the Refund Policy.',
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

const disclaimer: LegalDoc = {
  slug: 'disclaimer',
  title: 'Estimate disclaimer',
  summary:
    'Measurements, quantities and prices are estimates, not professional advice, and must be verified on site before anyone builds or pays from them.',
  sections: [
    {
      heading: 'Estimates only',
      paragraphs: [
        'Field Pro calculates from the information you supply: addresses, traced geometry, pitches, photographs, calibration references, map imagery and price books. Every area, quantity and price it shows is an estimate. Results can be wrong, and a wrong result can cost money if it is used without checking.',
        'Nothing Field Pro produces is a survey, an engineering design, an inspection, a permit document, a binding quotation or a warranty.',
      ],
    },
    {
      heading: 'Why results can be wrong',
      bullets: [
        'Inputs can be wrong: an address, a traced outline, a pitch, a wall height or a calibration reference that does not match the property.',
        'Photographs and satellite or aerial imagery cannot see under roofing, inside concrete, or behind a tree, and imagery may be months or years out of date.',
        'Map and building data come from third parties and may be incomplete, misaligned or simply wrong for a given property.',
        'Unit prices are the prices you or your company enter. Field Pro does not guarantee market, supplier or labour prices, and it does not lock them in.',
        'An unknown or low-confidence input is shown as unknown or flagged for review rather than guessed, so a result marked preliminary, unknown or low confidence is not a finished measurement.',
      ],
    },
    {
      heading: 'Not professional advice',
      paragraphs: [
        'Field Pro does not provide engineering, architectural, surveying, legal, tax, insurance or code-compliance advice, and using it does not create a professional relationship with us. Accessibility and code requirements, including the Americans with Disabilities Act and local accessibility rules, are for the qualified professional directing the work to confirm; the product flags when review is needed and does not certify compliance.',
        'Automated analysis is optional and abstains when it cannot support a conclusion. A suggestion it makes is a proposal for you to review and accept, not a verified fact.',
      ],
    },
    {
      heading: 'What you must confirm before work starts',
      bullets: [
        'Measure and verify the job on site before you bid, order material, cut or build.',
        'Follow the building codes that apply where the work is done, and obtain every required permit and inspection.',
        'Call 811 before any digging or concrete cutting to have underground utilities located.',
        'Use licensed engineers, surveyors, inspectors or other professionals wherever the law or the job requires them.',
        'Review every proposal, invoice and report before it is sent to a customer, and check that the prices and quantities in it are the ones you intend.',
      ],
    },
    {
      heading: 'Responsibility',
      paragraphs: [
        'The contractor, company and qualified professional directing the work remain responsible for the work, the bid, the price and the safety of the site. Our liability is limited as stated in the terms of service, and nothing here creates a promise that a result is accurate or fit for a particular job.',
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
        'The roof drawing canvas and the curb photo-capture screens are built and provide keyboard operation — the CAD resize handles accept arrow keys and curb points can be placed and moved from the keyboard — but neither screen has had a screen-reader walkthrough yet, and anything that depends on a map or canvas will need a keyboard-operable alternative before it ships.',
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

const dataSources: LegalDoc = {
  slug: 'data-sources',
  title: 'Data sources and your rights',
  summary:
    'Where building and map information comes from, which licences apply, its accuracy limits and your rights to use, correct or ask about it.',
  sections: [
    {
      heading: 'Status',
      paragraphs: [
        'Building footprints from the USA Structures dataset for the Texas launch region (Texas, Oklahoma, New Mexico, Arkansas and Louisiana) have been checked offline against their source file for record counts, geometry validity and agreement with the dataset\'s own area figures. Those dataset footprints are not yet shown in Field Pro. The footprints you see in the house builder are the ones you draw yourself, not dataset records. The offline checks do not measure how close an outline is to the true edge of a building on the ground, so no figure derived from them should be treated as surveyed or complete.',
      ],
    },
    {
      heading: 'Sources we use or plan to use',
      bullets: [
        'USA Structures (FEMA Geospatial Response Office, Oak Ridge National Laboratory and USGS): building footprints for structures over 450 sq ft, licensed CC BY 4.0. We credit the sources and keep this attribution wherever the data is shown. Property street addresses in the source are not kept.',
        'USGS National Structures Dataset point layer: US federal data, public domain, non-residential structure points such as schools and cemeteries.',
        'USGS 3D Elevation Program (LiDAR): US federal data, public domain, planned for roof height and shape where coverage exists.',
        'US Census TIGER/Line boundaries: US federal data, public domain, used for state, county and tract boundaries.',
        'Overture Maps buildings: released under ODbL because they are sourced from OpenStreetMap. We do not store derived building data from Overture or OpenStreetMap.',
        'OpenStreetMap: Open Database Licence (ODbL). Shown on maps with attribution only; derived databases are not stored or redistributed by Field Pro.',
        'Map imagery from Esri, Maxar, Earthstar Geographics and similar providers: licensed for display in Field Pro only. It may not be downloaded, stored or redistributed.',
      ],
    },
    {
      heading: 'Attribution',
      paragraphs: [
        'Where a source requires attribution, the map and the screens that use its data show it. Please keep these credits visible when you share a screenshot or export that includes map data.',
      ],
    },
    {
      heading: 'Accuracy and limits',
      paragraphs: [
        'Measurements and estimates are calculation aids. They are not surveys, engineering assessments, permit documents, insurance determinations or warranties. Photo damage checks only describe what is visible in a photo and cannot see under shingles or in the decking. A qualified professional must confirm measurements and conditions on site before work or payment depends on them.',
      ],
    },
    {
      heading: 'Your rights',
      bullets: [
        'You may ask what data Field Pro holds about a property you own or manage and where it came from.',
        'You may ask us to correct a building or parcel record you can show is wrong. We will review it against the source and record the outcome.',
        'You may object to an automated result. A person reviews disputed results before they are relied on.',
        'You may request removal of a property from displayed map data, including owner information shown in permit-lead lists. Removal requests go to ' +
          LEGAL.contactEmail +
          ' with the property address; we verify the request and remove the information from the lead lists we show. We cannot remove it from the city or county source records, which remain public.',
        'Where you rely on a Field Pro figure for a job, you remain responsible for checking it against your own site inspection and local requirements.',
      ],
    },
    {
      heading: 'Changes and contact',
      paragraphs: [
        'We update this page when a data source, licence or launch region changes. Questions and requests about data should go to the workspace owner or through the contact details in the Terms of service.',
      ],
    },
  ],
};

const refunds: LegalDoc = {
  slug: 'refunds',
  title: 'Refund policy',
  summary:
    'When a subscription or a one-time purchase is refunded, how to ask, and what happens after a refund.',
  sections: [
    {
      heading: 'Hosted workspace subscription',
      paragraphs: [
        'If you do not like Field Pro, email ' +
          LEGAL.contactEmail +
          ' within 30 days of your first payment and we will refund you in full, back to your original payment method. Send the email address you used at checkout. Refunds usually reach your account within 5 to 10 business days, depending on your bank.',
        'After 30 days, subscriptions are non-refundable. You can cancel at any time and keep access until the end of the billing period you have already paid for.',
      ],
    },
    {
      heading: 'Cancelling a subscription',
      paragraphs: [
        'To cancel, email ' +
          LEGAL.contactEmail +
          ' before your next renewal date. Your subscription stays active until the end of the current billing period, and nothing further is charged. Cancelling does not refund the period already paid for unless it is within the 30-day window above.',
      ],
    },
    {
      heading: 'Offline calculator (one-time purchase)',
      paragraphs: [
        'The Field Pro offline calculator is a single $150 USD payment. It is not a subscription: nothing renews and your card is never charged again. If the calculator does not work for you, email us within 14 days of purchase and we will refund the full $150 to your original payment method. After a refund, the download link stops working and your license to use the calculator ends; please delete your copy. After 14 days, we refund only if the law requires it, or if the calculator does not work as described on our website and we cannot fix the problem.',
      ],
    },
    {
      heading: 'Contact',
      paragraphs: [
        'Email ' +
          LEGAL.contactEmail +
          '. Please contact us before opening a card dispute so we can fix it quickly.',
      ],
    },
  ],
};

const dmca: LegalDoc = {
  slug: 'dmca',
  title: 'Copyright and DMCA policy',
  summary:
    'How to report copyright infringement in Field Pro, what a notice must include, and what happens next.',
  sections: [
    {
      heading: 'Designated agent',
      paragraphs: [
        'Field Pro respects copyright. Users can upload photos, logos and documents to the hosted workspace. If you believe something on Field Pro infringes your copyright, send a notice to our designated agent: Samad Alam, Field Pro, ' +
          LEGAL.contactEmail +
          ', +1 469-614-6681. We follow the Digital Millennium Copyright Act (17 U.S.C. § 512). Registration of this agent with the U.S. Copyright Office is still in progress; the contact above is the address to use until registration is complete. The public version of this policy is at ' +
          LEGAL.dmca +
          '.',
      ],
    },
    {
      heading: 'What a notice must include',
      bullets: [
        'Your physical or electronic signature.',
        'The copyrighted work you say is infringed.',
        'The material you say infringes it, with enough detail for us to find it.',
        'Your name, address, phone number and email address.',
        'A statement that you believe in good faith that the use is not authorized by the owner, its agent or the law.',
        'A statement, under penalty of perjury, that the notice is accurate and that you are the owner or are authorized to act for the owner.',
      ],
    },
    {
      heading: 'What we do',
      paragraphs: [
        'When we get a valid notice, we remove or disable the material quickly and tell the user who uploaded it.',
      ],
    },
    {
      heading: 'Counter-notice',
      paragraphs: [
        'If your material was removed by mistake, you can send a counter-notice to the agent. Include your signature, the removed material and where it was, a statement under penalty of perjury that it was removed by mistake or misidentification, your name, address and phone number, and your consent to the jurisdiction of the federal court for your address (or for Dallas County, Texas, if you are outside the United States). We may restore the material in 10 to 14 business days unless the person who complained files a lawsuit.',
      ],
    },
    {
      heading: 'Repeat infringers and false notices',
      paragraphs: [
        'We end the accounts of users who infringe copyright repeatedly. Anyone who knowingly makes a false claim in a notice or counter-notice can be liable for damages under 17 U.S.C. § 512(f).',
      ],
    },
  ],
};

export const LEGAL_DOCS: readonly LegalDoc[] = [
  privacy,
  terms,
  disclaimer,
  cookies,
  accessibility,
  dataSources,
  refunds,
  dmca,
];

export const LEGAL_DOC_BY_SLUG: Readonly<Record<string, LegalDoc>> = Object.fromEntries(
  LEGAL_DOCS.map((doc) => [doc.slug, doc]),
);

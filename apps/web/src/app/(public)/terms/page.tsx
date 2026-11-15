import type { Metadata } from 'next';
import { LEGAL_CONTACT, LegalPage } from '../../../components/legal/LegalPage';

export const metadata: Metadata = { title: 'Terms of Use' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use">
      <p>
        These terms apply to anyone who signs in to and uses Field Pro. By using the app you agree
        to them.
      </p>
      <h2>1. Your account</h2>
      <p>
        Keep your sign-in secure and do not share your account. You are responsible for activity
        under it. Tell us right away if you think it has been misused.
      </p>
      <h2>2. Your data</h2>
      <p>
        Your company owns the data it puts into Field Pro. You must have the right to upload it,
        including customers&apos; personal information and photos, and you must only use it
        lawfully. We use it only to provide the service, as described in the{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>
      <h2>3. Acceptable use</h2>
      <p>
        Do not use Field Pro to break the law, send spam or messages without the recipient&apos;s
        consent, upload malware, try to access other workspaces or accounts, or interfere with the
        service.
      </p>
      <h2>4. License</h2>
      <p>
        Field Pro is licensed, not sold. You may use it for your business under these terms and the
        license you purchased. You may not resell, copy, redistribute or reverse-engineer it, except
        where the law allows.
      </p>
      <h2>5. Estimates and measurements</h2>
      <p>
        Measurements, takeoffs, pricing and other outputs are tools to help you. Always verify them
        before ordering materials, quoting a customer or starting work. You are responsible for your
        quotes, contracts and work.
      </p>
      <h2>6. Availability and changes</h2>
      <p>
        We work to keep Field Pro available and secure, but we do not guarantee it will always be
        uninterrupted or error-free. We may update or change features.
      </p>
      <h2>7. No warranty and limitation of liability</h2>
      <p>
        To the extent the law allows, Field Pro is provided &quot;as is&quot; without warranties,
        and our total liability for any claim is limited to the amount you paid for Field Pro in the
        12 months before the claim. We are not liable for indirect or consequential losses. Nothing
        here limits rights you have under laws that cannot be waived.
      </p>
      <h2>8. Ending use</h2>
      <p>You can stop using Field Pro at any time. We may suspend accounts that break these terms.</p>
      <h2>9. Contact</h2>
      <p>
        Questions: <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>
      </p>
    </LegalPage>
  );
}

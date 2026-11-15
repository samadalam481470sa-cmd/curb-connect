import type { Metadata } from 'next';
import { LEGAL_CONTACT, LegalPage } from '../../../components/legal/LegalPage';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains what information Field Pro collects when you and your company use the
        app, and how it is used. Your company (the workspace owner) decides what customer and job
        data goes into its workspace and is responsible for having the right to store it.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>
          <b>Account details:</b> your name, email and the identity provider you sign in with (for
          example Microsoft or Google). We never see your password.
        </li>
        <li>
          <b>Workspace data:</b> customers, contacts, addresses, projects, measurements, photos,
          documents, notes and approvals that your team enters.
        </li>
        <li>
          <b>Technical data:</b> device and browser type, IP address, error reports and security
          logs, used to keep the service running and protect accounts.
        </li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To provide the app: sign-in, syncing, estimates, documents and notifications.</li>
        <li>To secure the service, prevent abuse and fix problems.</li>
        <li>To meet legal obligations.</li>
      </ul>
      <p>We do not sell personal information and we do not use it for advertising.</p>
      <h2>Email and text messages</h2>
      <p>
        The app sends service emails about your work (for example invitations, approvals and job
        updates). You can turn notification categories off in Settings. Text (SMS) notifications
        are off by default and are only sent after you opt in; you can opt out at any time in
        Settings or by replying STOP. Message and data rates may apply. We do not send marketing
        messages without your separate consent.
      </p>
      <p>
        If your company uses Field Pro to email or text its own customers, your company must have
        those customers&apos; consent and follow the rules that apply (such as CAN-SPAM for email
        and the TCPA for texts in the US).
      </p>
      <h2>Who we share it with</h2>
      <p>
        Only with service providers that host and operate the app (such as cloud hosting, file
        storage, email delivery and sign-in providers), each bound to protect the data, and when the
        law requires it. Data inside a workspace is visible to that workspace&apos;s members
        according to their roles.
      </p>
      <h2>Retention and deletion</h2>
      <p>
        Workspace data is kept while the workspace is active. When a workspace is closed, or on
        request, we delete it within a reasonable time, except records we must keep by law.
      </p>
      <h2>Your rights</h2>
      <p>
        You can ask to access, correct, export or delete your personal information. Depending on
        where you live (for example California or the EU/UK) you may have additional rights. If your
        data was added by a company that uses Field Pro, contact that company first. To make a
        request, email <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.
      </p>
      <h2>Children</h2>
      <p>Field Pro is a business tool and is not intended for children under 16.</p>
      <h2>Changes</h2>
      <p>
        If we change this policy we will update the date above and, for significant changes, notify
        workspace owners.
      </p>
    </LegalPage>
  );
}

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OnboardingWizard } from '../../../features/onboarding/OnboardingWizard';

export const metadata: Metadata = { title: 'Company setup' };

export default function Page() {
  return (
    <Suspense>
      <OnboardingWizard />
    </Suspense>
  );
}

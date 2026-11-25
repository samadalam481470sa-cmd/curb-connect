import type { Metadata } from 'next';
import { EnterpriseBlueprintView } from '../../../../features/enterprise/EnterpriseBlueprintView';

export const metadata: Metadata = { title: 'Enterprise Blueprint' };
export default function Page() {
  return <EnterpriseBlueprintView />;
}

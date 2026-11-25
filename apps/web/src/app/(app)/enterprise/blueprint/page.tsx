import type { Metadata } from 'next';
import { EnterpriseBlueprintView } from '../../../../features/enterprise/EnterpriseBlueprintView';

export const metadata: Metadata = { title: 'Enterprise Blueprint' };
export default async function Page({ searchParams }: PageProps<'/enterprise/blueprint'>) {
  const { wp } = await searchParams;
  const initialCode = typeof wp === 'string' ? wp : '001';
  return <EnterpriseBlueprintView key={initialCode} initialCode={initialCode} />;
}

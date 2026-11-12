import type { Metadata } from 'next';
import { JobsWorkspace } from '../../../features/jobs/JobsBidding';

export const metadata: Metadata = { title: 'Jobs' };
export default function Page(){ return <JobsWorkspace/>; }

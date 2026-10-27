import { redirect } from 'next/navigation';

/** /home is an alias: the registry's Home route is "/" (PLT-011 D). */
export default function HomeAlias() {
  redirect('/');
}

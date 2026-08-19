import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignOutButton } from '@/components/sign-out-button';
import { getPrincipal } from '@/server/authorization';

export default async function ForbiddenPage() {
  const principal = await getPrincipal(await headers());
  if (!principal) redirect('/sign-in');

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-md rounded-md border border-slate-300 bg-white p-6">
        <p className="text-sm font-semibold text-slate-600">Provider Tracker</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Access denied</h1>
        <p className="mt-2 text-sm text-slate-600">Your account does not have access to this page.</p>
        <div className="mt-6 flex items-center gap-3">
          <Link href="/" className="rounded-md bg-slate-800 px-4 py-2 text-sm font-semibold text-white">
            Go to dashboard
          </Link>
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}

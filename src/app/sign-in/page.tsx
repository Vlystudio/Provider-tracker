import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignInForm } from '@/components/sign-in-form';
import { getPrincipal } from '@/server/authorization';

export default async function SignInPage() {
  if (await getPrincipal(await headers())) redirect('/');

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-md rounded-md border border-slate-300 bg-white p-6">
        <p className="text-sm font-semibold text-slate-600">Provider Tracker</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Sign in</h1>
        <p className="mt-2 text-sm text-slate-600">Use the account provided by your administrator.</p>
        <SignInForm />
      </section>
    </main>
  );
}

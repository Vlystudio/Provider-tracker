import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignInForm } from '@/components/sign-in-form';
import { InlineMessage } from '@/components/ui';
import { getPrincipal } from '@/server/authorization';

export default async function SignInPage({ searchParams }: { searchParams?: Promise<{ reason?: string; status?: string }> }) {
  if (await getPrincipal(await headers())) redirect('/');
  const params: { reason?: string; status?: string } = await Promise.resolve(searchParams ?? {});

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-md rounded border border-slate-300 bg-white p-6">
        <p className="text-sm font-semibold text-slate-600">Provider Tracker</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Sign in</h1>
        <p className="mt-2 text-sm text-slate-600">Use the account provided by your administrator.</p>
        {params.reason === 'required' ? (
          <div className="mt-5"><InlineMessage tone="info">Your sign-in is no longer active. Sign in to continue.</InlineMessage></div>
        ) : params.status === 'signed-out' ? (
          <div className="mt-5"><InlineMessage tone="success" role="status">You are signed out.</InlineMessage></div>
        ) : null}
        <SignInForm />
      </section>
    </main>
  );
}

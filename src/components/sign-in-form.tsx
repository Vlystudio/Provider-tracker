'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

export function SignInForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const password = String(form.get('password') ?? '');
    const result = await authClient.signIn.email({ email, password, rememberMe: false });

    if (result.error) {
      setPending(false);
      setError(
        result.error.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : 'The email or password was not accepted.',
      );
      return;
    }

    router.replace('/');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
      <label className="block text-sm font-medium text-slate-700" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        required
        disabled={pending}
        aria-describedby={error ? 'sign-in-error' : undefined}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
      />

      <label className="block text-sm font-medium text-slate-700" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        disabled={pending}
        aria-describedby={error ? 'sign-in-error' : undefined}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-2"
      />

      {error ? (
        <p id="sign-in-error" ref={errorRef} role="alert" tabIndex={-1} className="text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { InlineMessage } from './ui';

export function SignInForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [pending, setPending] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setFieldErrors({});
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim().toLowerCase();
    const password = String(form.get('password') ?? '');
    const nextFieldErrors: { email?: string; password?: string } = {};

    if (!email) nextFieldErrors.email = 'Enter your email address.';
    else if (!/^\S+@\S+\.\S+$/.test(email)) nextFieldErrors.email = 'Enter a valid email address.';
    if (!password) nextFieldErrors.password = 'Enter your password.';

    if (Object.keys(nextFieldErrors).length) {
      setFieldErrors(nextFieldErrors);
      if (nextFieldErrors.email) emailRef.current?.focus();
      else passwordRef.current?.focus();
      return;
    }

    setPending(true);
    const result = await authClient.signIn.email({ email, password, rememberMe: false });

    if (result.error) {
      setPending(false);
      setError(result.error.status === 429 ? 'Too many attempts. Wait a minute and try again.' : 'The email or password was not accepted.');
      return;
    }

    router.replace('/');
    router.refresh();
  }

  return (
    <form method="post" action="/api/auth/sign-in/email" onSubmit={submit} className="mt-6 space-y-4" noValidate>
      <label className="form-label" htmlFor="email">
        Email
        <input
          ref={emailRef}
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          disabled={pending}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? 'email-error' : undefined}
          className="form-control"
        />
        {fieldErrors.email ? <span id="email-error" className="form-error">{fieldErrors.email}</span> : null}
      </label>

      <label className="form-label" htmlFor="password">
        Password
        <input
          ref={passwordRef}
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? 'password-error' : undefined}
          className="form-control"
        />
        {fieldErrors.password ? <span id="password-error" className="form-error">{fieldErrors.password}</span> : null}
      </label>

      {error ? (
        <div ref={errorRef} tabIndex={-1}>
          <InlineMessage tone="error" role="alert">{error}</InlineMessage>
        </div>
      ) : null}

      <button type="submit" disabled={pending} className="button button-primary w-full">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

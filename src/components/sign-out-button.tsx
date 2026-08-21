'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function signOut() {
    setPending(true);
    setError('');
    const result = await authClient.signOut();
    if (result.error) {
      setPending(false);
      setError('Sign out failed. Try again.');
      return;
    }
    router.replace('/sign-in?status=signed-out');
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end">
      <button type="button" onClick={signOut} disabled={pending} className="button button-secondary">
        {pending ? 'Signing out…' : 'Sign out'}
      </button>
      {error ? <span role="alert" className="mt-1 text-xs font-medium text-red-800">{error}</span> : null}
    </div>
  );
}

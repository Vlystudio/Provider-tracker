// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SignInForm } from './sign-in-form';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: { signIn: { email: vi.fn() } },
}));

describe('sign-in form', () => {
  it('never falls back to a GET submission that places credentials in the URL', () => {
    render(<SignInForm />);

    const form = screen.getByRole('button', { name: 'Sign in' }).closest('form');
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.getAttribute('action')).toBe('/api/auth/sign-in/email');
  });
});

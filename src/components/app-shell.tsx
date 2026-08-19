'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const navItems = [
  { label: 'Dashboard', href: '/' },
  { label: 'New Call', href: '/new-call' },
  { label: 'Call Log', href: '/call-log' },
  { label: 'Provider Search', href: '/provider-search' },
  { label: 'Authorization Summary', href: '/authorization-summary' },
  { label: 'Review Queue', href: '/review-queue' },
  { label: 'Facilities', href: '/facilities' },
  { label: 'Reports', href: '/reports' },
  { label: 'Admin', href: '/admin' },
];

export function AppShell({
  children,
  dataMode = 'database',
  statusMessage,
}: {
  children: React.ReactNode;
  dataMode?: 'database' | 'demo';
  statusMessage?: string | null;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [menuOpen]);

  return (
    <div className="app-shell">
      <header className="border-b border-slate-300 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              ref={menuButtonRef}
              type="button"
              aria-label="Open menu"
              aria-expanded={menuOpen}
              aria-controls="main-navigation"
              onClick={() => setMenuOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            >
              <Menu aria-hidden="true" size={20} />
            </button>
            <Link href="/" className="text-base font-semibold text-slate-900">
              Provider Tracker
            </Link>
          </div>
          <span className="text-sm text-slate-600">URA User</span>
        </div>
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="Dismiss menu"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-slate-950/35"
          />
          <aside
            id="main-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Main menu"
            className="relative h-full w-72 border-r border-slate-300 bg-white p-4 shadow-xl"
          >
            <div className="mb-5 flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Provider Tracker</p>
                <p className="text-xs text-slate-500">URA</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"
              >
                <X aria-hidden="true" size={20} />
              </button>
            </div>

            <nav className="space-y-1 text-sm" aria-label="Main navigation">
              {navItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className={clsx(
                    'block rounded-md px-3 py-2.5',
                    pathname === item.href
                      ? 'bg-slate-800 font-semibold text-white'
                      : 'text-slate-700 hover:bg-slate-100',
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </aside>
        </div>
      ) : null}

      <main className="mx-auto max-w-7xl space-y-5 p-4 lg:p-6">
          {dataMode === 'demo' ? (
            <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              <span className="font-semibold">Sample data</span>
              <span>Local testing only</span>
            </div>
          ) : null}
          {statusMessage ? (
            <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="font-semibold">Database unavailable</p>
              <p className="mt-1">{statusMessage}</p>
            </div>
          ) : null}
          {children}
      </main>
    </div>
  );
}

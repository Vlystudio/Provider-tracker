'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { can, type Permission, type UserRole } from '@/lib/access-control';
import { SignOutButton } from './sign-out-button';
import { NotificationIndicator } from './notification-indicator';

const navItems = [
  { label: 'Dashboard', href: '/', permission: 'app:access', section: 'Workspace' },
  { label: 'Provider Search', href: '/provider-search', permission: 'operations:read', section: 'Operations' },
  { label: 'Authorizations', href: '/authorization-summary', permission: 'operations:read', section: 'Operations' },
  { label: 'Review Queue', href: '/review-queue', permission: 'operations:read', section: 'Operations' },
  { label: 'Work Inbox', href: '/work', permission: 'work:read', section: 'Operations' },
  { label: 'Changes', href: '/changes', permission: 'changes:read', section: 'Oversight' },
  { label: 'Coverage Watches', href: '/coverage', permission: 'coverage:read', section: 'Oversight' },
  { label: 'Notifications', href: '/notifications', permission: 'notifications:read', section: 'Workspace' },
  { label: 'Call Log', href: '/call-log', permission: 'operations:read', section: 'Operations' },
  { label: 'Facilities', href: '/facilities', permission: 'operations:read', section: 'Operations' },
  { label: 'Reports', href: '/reports', permission: 'reports:read', section: 'Oversight' },
  { label: 'Data Quality', href: '/data-quality', permission: 'admin:read', section: 'System' },
  { label: 'Duplicate Review', href: '/duplicates', permission: 'admin:read', section: 'System' },
  { label: 'Audit', href: '/audit', permission: 'audit:read', section: 'Oversight' },
  { label: 'Administration', href: '/admin', permission: 'admin:read', section: 'System' },
  { label: 'Automation', href: '/automation', permission: 'automation:read', section: 'System' },
] satisfies Array<{ label: string; href: string; permission: Permission; section: string }>;

const roleLabels: Record<UserRole, string> = {
  admin: 'Administrator',
  ura_user: 'URA user',
  report_viewer: 'Report viewer',
  auditor: 'Auditor',
};

export function AppShell({
  children,
  dataMode = 'database',
  statusMessage,
  user,
}: {
  children: React.ReactNode;
  dataMode?: 'database' | 'demo';
  statusMessage?: string | null;
  user: { name: string; role: UserRole };
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
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

  const visibleItems = navItems.filter((item) => can(user.role, item.permission));
  const sections = [...new Set(visibleItems.map((item) => item.section))];

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="app-header border-b border-slate-300 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <NotificationIndicator />
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
          <div className="flex items-center gap-3">
            <span className="hidden text-right text-sm text-slate-600 sm:block">
              <span className="block font-medium text-slate-800">{user.name}</span>
              <span className="block text-xs">{roleLabels[user.role]}</span>
            </span>
            <SignOutButton />
          </div>
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
            ref={dialogRef}
            id="main-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Main menu"
            className="relative h-full w-72 overflow-y-auto border-r border-slate-300 bg-white p-4 shadow-lg"
          >
            <div className="mb-5 flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Provider Tracker</p>
                <p className="text-xs text-slate-500">{roleLabels[user.role]}</p>
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

            <nav className="space-y-5 text-sm" aria-label="Main navigation">
              {sections.map((section) => (
                <div key={section}>
                  <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-[0.07em] text-slate-500">{section}</p>
                  <div className="space-y-1">
                    {visibleItems.filter((item) => item.section === section).map((item) => (
                      <Link
                        key={item.label}
                        href={item.href}
                        onClick={() => setMenuOpen(false)}
                        className={clsx(
                          'block rounded px-3 py-2.5',
                          pathname === item.href
                            ? 'bg-slate-800 font-semibold text-white'
                            : 'text-slate-700 hover:bg-slate-100',
                        )}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
            <div className="mt-6 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">
              Signed in as <span className="font-medium text-slate-700">{user.name}</span>
            </div>
          </aside>
        </div>
      ) : null}

      <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl space-y-5 p-4 lg:p-6">
          {dataMode === 'demo' ? (
            <div className="demo-banner flex items-center justify-between rounded border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-950">
              <span><strong>Demo data</strong> · local testing</span>
              <span className="hidden text-xs sm:inline">Not for operational use</span>
            </div>
          ) : null}
          {statusMessage ? (
            <div role="status" className="inline-message border-amber-300 bg-amber-50 text-amber-950">
              <p className="font-semibold">Data could not be loaded</p>
              <p className="mt-1">{statusMessage}</p>
            </div>
          ) : null}
          {children}
      </main>
    </div>
  );
}

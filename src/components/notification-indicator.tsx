'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';

export function NotificationIndicator() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/notifications?view=unread&limit=1', { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<{ unreadCount?: number }> : null)
      .then((data) => setCount(data?.unreadCount ?? 0))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return (
    <Link
      href="/notifications"
      aria-label={count ? `${count} unread notification${count === 1 ? '' : 's'}` : 'Notifications'}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700"
    >
      <Bell aria-hidden="true" size={19} />
      {count ? <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-slate-800 px-1 text-center text-[11px] font-bold leading-5 text-white">{count > 99 ? '99+' : count}</span> : null}
    </Link>
  );
}

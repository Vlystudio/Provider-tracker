import { clsx } from 'clsx';

export type StatusTone = 'positive' | 'warning' | 'danger' | 'info' | 'neutral';

export function PageHeader({
  eyebrow,
  title,
  summary,
  meta,
}: {
  eyebrow?: string;
  title: string;
  summary?: string;
  meta?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="page-kicker">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        {summary ? <p className="page-summary">{summary}</p> : null}
      </div>
      {meta ? <div className="shrink-0 text-sm text-slate-600">{meta}</div> : null}
    </header>
  );
}

export function StatusBadge({ tone = 'neutral', children }: { tone?: StatusTone; children: React.ReactNode }) {
  return <span className="status-badge" data-tone={tone}>{children}</span>;
}

export function InlineMessage({
  tone,
  title,
  children,
  role,
}: {
  tone: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: React.ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div
      role={role}
      className={clsx(
        'inline-message',
        tone === 'info' && 'border-blue-200 bg-blue-50 text-blue-950',
        tone === 'success' && 'border-green-300 bg-green-50 text-green-950',
        tone === 'warning' && 'border-amber-300 bg-amber-50 text-amber-950',
        tone === 'error' && 'border-red-300 bg-red-50 text-red-950',
      )}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? 'mt-1' : undefined}>{children}</div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <h2 className="section-title">{title}</h2>
      <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-slate-600">{description}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ResultsSummary({ count, noun, activeFilters = 0 }: { count: number; noun: string; activeFilters?: number }) {
  const pluralNoun = /[^aeiou]y$/i.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`;
  return (
    <p className="text-sm text-slate-600" role="status">
      {count} {count === 1 ? noun : pluralNoun}
      {activeFilters ? ` · ${activeFilters} active ${activeFilters === 1 ? 'filter' : 'filters'}` : ''}
    </p>
  );
}

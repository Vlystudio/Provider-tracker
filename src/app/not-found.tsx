export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
      <div className="card max-w-md p-8 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">404</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">The requested URA workflow could not be located.</p>
      </div>
    </div>
  );
}

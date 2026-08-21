'use client';

import { useRef, useState } from 'react';
import { humanizeKey } from '@/lib/format';
import { InlineMessage, StatusBadge, type StatusTone } from './ui';

type UserRole = 'admin' | 'ura_user' | 'report_viewer' | 'auditor';

export type ManagedUser = {
  id: string;
  name: string;
  displayName: string | null;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const roleOptions: Array<{ value: UserRole; label: string }> = [
  { value: 'ura_user', label: 'URA user' },
  { value: 'report_viewer', label: 'Report viewer' },
  { value: 'auditor', label: 'Auditor' },
  { value: 'admin', label: 'Administrator' },
];

function accountTone(active: boolean): StatusTone {
  return active ? 'positive' : 'neutral';
}

export function UserManagement({ initialUsers, currentUserId }: { initialUsers: ManagedUser[]; currentUserId: string }) {
  const [users, setUsers] = useState(initialUsers);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, UserRole>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const createFormRef = useRef<HTMLFormElement>(null);

  function updateLocal(updated: ManagedUser) {
    setUsers((current) => current.map((user) => user.id === updated.id ? { ...user, ...updated } : user));
  }

  async function patchUser(user: ManagedUser, patch: Partial<Pick<ManagedUser, 'role' | 'isActive'>>) {
    setMessage(null);
    setPendingId(user.id);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => ({})) as { user?: ManagedUser; error?: string };
      if (!response.ok || !body.user) {
        setMessage({ tone: 'error', text: body.error ?? 'The account could not be updated.' });
        return;
      }
      updateLocal(body.user);
      setRoleDrafts((current) => ({ ...current, [user.id]: body.user!.role }));
      setConfirmDeactivateId(null);
      setMessage({ tone: 'success', text: `${body.user.name} was updated.` });
    } catch {
      setMessage({ tone: 'error', text: 'The account could not be updated. Check the connection and try again.' });
    } finally {
      setPendingId(null);
    }
  }

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setCreating(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: String(form.get('name') ?? '').trim(),
          email: String(form.get('email') ?? '').trim(),
          password: String(form.get('password') ?? ''),
          role: String(form.get('role') ?? 'ura_user'),
        }),
      });
      const body = await response.json().catch(() => ({})) as { user?: ManagedUser; error?: string };
      if (!response.ok || !body.user) {
        setMessage({ tone: 'error', text: body.error ?? 'The account could not be created.' });
        return;
      }
      setUsers((current) => [...current, body.user!].sort((a, b) => a.name.localeCompare(b.name)));
      createFormRef.current?.reset();
      setMessage({ tone: 'success', text: `${body.user.name} can now sign in.` });
    } catch {
      setMessage({ tone: 'error', text: 'The account could not be created. Check the connection and try again.' });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      {message ? <InlineMessage tone={message.tone} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</InlineMessage> : null}

      <section className="panel p-5" aria-labelledby="create-user-heading">
        <div className="mb-4 border-b border-slate-200 pb-3">
          <h2 id="create-user-heading" className="section-title">Add account</h2>
          <p className="mt-1 text-sm text-slate-600">Create an account and assign its starting role.</p>
        </div>
        <form ref={createFormRef} onSubmit={createUser} className="grid gap-4 lg:grid-cols-4">
          <label className="form-label">
            Name
            <input className="form-control" name="name" required minLength={2} autoComplete="off" />
          </label>
          <label className="form-label">
            Email
            <input className="form-control" name="email" type="email" required autoComplete="off" />
          </label>
          <label className="form-label">
            Temporary password
            <input className="form-control" name="password" type="password" required minLength={14} autoComplete="new-password" aria-describedby="new-account-password-help" />
            <span id="new-account-password-help" className="form-help">At least 14 characters with upper/lowercase, a number, and a symbol.</span>
          </label>
          <label className="form-label">
            Role
            <select className="form-control" name="role" defaultValue="ura_user">
              {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
          </label>
          <div className="lg:col-span-4">
            <button className="button button-primary" type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create account'}</button>
          </div>
        </form>
      </section>

      <section className="table-shell" aria-labelledby="staff-accounts-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 px-4 py-3">
          <div>
            <h2 id="staff-accounts-heading" className="section-title">Staff accounts</h2>
            <p className="mt-1 text-xs text-slate-500">Role or status changes end that user’s active sessions.</p>
          </div>
          <span className="text-sm text-slate-600">{users.length} accounts</span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Status</th>
                <th scope="col">Role</th>
                <th scope="col">Account action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.id === currentUserId;
                const draftRole = roleDrafts[user.id] ?? user.role;
                const pending = pendingId === user.id;
                return (
                  <tr key={user.id}>
                    <td>
                      <span className="block font-semibold text-slate-950">{user.displayName || user.name}</span>
                      <span className="block text-xs text-slate-500">{user.email}</span>
                      {isSelf ? <span className="mt-1 block text-xs font-medium text-blue-800">Current account</span> : null}
                    </td>
                    <td><StatusBadge tone={accountTone(user.isActive)}>{user.isActive ? 'Active' : 'Inactive'}</StatusBadge></td>
                    <td className="min-w-56">
                      <div className="flex items-center gap-2">
                        <select
                          className="form-control mt-0 min-w-40"
                          aria-label={`Role for ${user.name}`}
                          value={draftRole}
                          disabled={isSelf || pending}
                          onChange={(event) => setRoleDrafts((current) => ({ ...current, [user.id]: event.target.value as UserRole }))}
                        >
                          {roleOptions.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                        </select>
                        <button
                          type="button"
                          className="button button-secondary"
                          disabled={isSelf || pending || draftRole === user.role}
                          onClick={() => patchUser(user, { role: draftRole })}
                        >
                          Apply
                        </button>
                      </div>
                    </td>
                    <td className="min-w-64">
                      {isSelf ? (
                        <span className="text-sm text-slate-500">Manage your own account through another administrator.</span>
                      ) : confirmDeactivateId === user.id ? (
                        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                          <p className="font-semibold">Deactivate {user.name}?</p>
                          <p className="mt-1">They will be signed out and unable to sign in.</p>
                          <div className="mt-3 flex gap-2">
                            <button type="button" className="button button-danger" disabled={pending} onClick={() => patchUser(user, { isActive: false })}>Deactivate</button>
                            <button type="button" className="button button-secondary" disabled={pending} onClick={() => setConfirmDeactivateId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : user.isActive ? (
                        <button type="button" className="button button-secondary" disabled={pending} onClick={() => setConfirmDeactivateId(user.id)}>Deactivate</button>
                      ) : (
                        <button type="button" className="button button-secondary" disabled={pending} onClick={() => patchUser(user, { isActive: true })}>Activate</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="sr-only">Available roles: {roleOptions.map((role) => humanizeKey(role.value)).join(', ')}.</p>
    </div>
  );
}

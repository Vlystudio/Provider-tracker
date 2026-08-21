import 'dotenv/config';

import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditEvents, users } from '../src/db/schema';
import { createTrustedProvisioningAuth } from '../src/server/auth';
import { getDatabasePool, requireDatabaseClient } from '../src/server/database';
import { isCommonPassword } from '../src/server/password-policy';

const inputSchema = z.object({
  email: z.string().email().max(254).transform((value) => value.trim().toLowerCase()),
  name: z.string().trim().min(2).max(100),
  password: z
    .string()
    .min(15)
    .max(128)
    .refine((value) => !isCommonPassword(value), 'Choose a password that is not commonly used.'),
});

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '--';
}

async function readPassword(): Promise<string> {
  const supplied = process.env.PROVIDER_TRACKER_ADMIN_PASSWORD;
  if (supplied) return supplied;
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error('Run this command in a terminal or provide PROVIDER_TRACKER_ADMIN_PASSWORD through a secure process environment.');
  }

  process.stdout.write('Password: ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (key: string) => {
      if (key === '\u0003') {
        finish();
        reject(new Error('Administrator provisioning was cancelled.'));
        return;
      }
      if (key === '\r' || key === '\n') {
        process.stdin.off('data', onData);
        finish();
        resolve(value);
        return;
      }
      if (key === '\u007f' || key === '\b') {
        value = value.slice(0, -1);
        return;
      }
      value += key;
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  const email = argument('email');
  const name = argument('name');
  if (!email || !name) {
    throw new Error('Usage: npm run admin:bootstrap -- --email admin@example.org --name "Administrator"');
  }

  const input = inputSchema.parse({ email, name, password: await readPassword() });
  const db = requireDatabaseClient();
  const pool = getDatabasePool();
  if (!pool) throw new Error('DATABASE_URL is required.');

  const lockClient = await pool.connect();
  try {
    await lockClient.query('SELECT pg_advisory_lock(hashtext($1))', ['provider-tracker-admin-bootstrap']);

    const [adminCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(sql`${users.role} = 'admin' and ${users.isActive} = true and ${users.isServiceAccount} = false`);
    if ((adminCount?.count ?? 0) > 0) {
      throw new Error('An active administrator already exists. Use the protected user administration workflow.');
    }

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (existing) throw new Error('That email already belongs to an existing account.');

    const provisioningAuth = createTrustedProvisioningAuth();
    const created = await provisioningAuth.api.signUpEmail({
      body: { email: input.email, password: input.password, name: input.name },
    });

    try {
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            role: 'admin',
            emailVerified: true,
            displayName: input.name,
            initials: initialsFor(input.name),
            isActive: true,
            isServiceAccount: false,
            updatedAt: new Date(),
          })
          .where(eq(users.id, created.user.id));
        await tx.insert(auditEvents).values({
          actorId: created.user.id,
          action: 'admin.bootstrap',
          result: 'success',
          entityType: 'user',
          entityId: created.user.id,
          metadata: { method: 'trusted-command' },
        });
      });
    } catch (error) {
      await db.delete(users).where(eq(users.id, created.user.id));
      throw error;
    }

    console.log(`Created the initial administrator: ${input.email}`);
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', ['provider-tracker-admin-bootstrap']);
    lockClient.release();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Administrator provisioning failed.');
  process.exitCode = 1;
});

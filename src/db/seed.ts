import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { createDatabase } from './client';
import { users } from './schema';

const systemUser = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'URA Workbook Import',
  email: 'system-import@local.invalid',
  displayName: 'URA Workbook Import',
  initials: 'SYS',
  role: 'auditor' as const,
  isActive: true,
  isServiceAccount: true,
};

async function seed() {
  if (process.env.APP_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
    throw new Error('Production seeding is disabled. Set ALLOW_PRODUCTION_SEED=true only in an approved runbook.');
  }

  const database = createDatabase();
  try {
    await database.db.transaction(async (tx) => {
      await tx
        .insert(users)
        .values(systemUser)
        .onConflictDoUpdate({
          target: users.email,
          set: {
            displayName: systemUser.displayName,
            name: systemUser.name,
            initials: systemUser.initials,
            role: systemUser.role,
            isActive: true,
            isServiceAccount: true,
            updatedAt: sql`now()`,
          },
        });

    });

    console.log('Seeded the non-login import identity.');
  } finally {
    await database.close();
  }
}

seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

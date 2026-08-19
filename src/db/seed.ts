import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { createDatabase } from './client';
import { bookingOutBuckets, users } from './schema';

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

const bookingBuckets = [
  { code: 'unknown', label: 'Unknown / not recorded', lowerBoundDays: null, upperBoundDays: null, rank: 0 },
  { code: '0_7_days', label: '0–7 days', lowerBoundDays: 0, upperBoundDays: 7, rank: 10 },
  { code: '8_14_days', label: '8–14 days', lowerBoundDays: 8, upperBoundDays: 14, rank: 20 },
  { code: '15_21_days', label: '15–21 days', lowerBoundDays: 15, upperBoundDays: 21, rank: 30 },
  { code: '22_28_days', label: '22–28 days', lowerBoundDays: 22, upperBoundDays: 28, rank: 40 },
  { code: '29_plus_days', label: '29+ days', lowerBoundDays: 29, upperBoundDays: null, rank: 50 },
];

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

      for (const bucket of bookingBuckets) {
        await tx
          .insert(bookingOutBuckets)
          .values(bucket)
          .onConflictDoUpdate({
            target: bookingOutBuckets.code,
            set: {
              label: bucket.label,
              lowerBoundDays: bucket.lowerBoundDays,
              upperBoundDays: bucket.upperBoundDays,
              rank: bucket.rank,
              active: true,
              updatedAt: sql`now()`,
            },
          });
      }
    });

    console.log(`Seeded ${bookingBuckets.length} booking buckets and the non-login import identity.`);
  } finally {
    await database.close();
  }
}

seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

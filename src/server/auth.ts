import 'server-only';

import { eq } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { accounts, authRateLimits, sessions, users, verificationTokens } from '@/db/schema';
import { getSecurityConfig } from './config';
import { requireDatabaseClient } from './database';
import { hashAuditValue } from './audit';

function buildAuth(allowTrustedProvisioning = false) {
  const config = getSecurityConfig();
  const db = requireDatabaseClient();
  const useSecureCookies = new URL(config.BETTER_AUTH_URL).protocol === 'https:';

  return betterAuth({
    appName: 'Provider Tracker',
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: config.AUTH_TRUSTED_ORIGINS,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verificationTokens,
        rateLimit: authRateLimits,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !allowTrustedProvisioning,
      minPasswordLength: 15,
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
    },
    session: {
      expiresIn: config.AUTH_SESSION_ABSOLUTE_SECONDS,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    user: {
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
      additionalFields: {
        displayName: { type: 'string', required: false, input: false },
        initials: { type: 'string', required: true, defaultValue: '--', input: false },
        role: {
          type: ['admin', 'ura_user', 'report_viewer', 'auditor'],
          required: true,
          defaultValue: 'ura_user',
          input: false,
        },
        isActive: { type: 'boolean', required: true, defaultValue: true, input: false },
        isServiceAccount: { type: 'boolean', required: true, defaultValue: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const [user] = await db
              .select({ isActive: users.isActive, isServiceAccount: users.isServiceAccount })
              .from(users)
              .where(eq(users.id, session.userId))
              .limit(1);

            if (!user?.isActive || user.isServiceAccount) return false;
            return {
              data: {
                ...session,
                ipAddress: session.ipAddress ? hashAuditValue(session.ipAddress) : null,
                userAgent: null,
              },
            };
          },
          after: async (session) => {
            await db
              .update(users)
              .set({ lastSignedInAt: new Date(), updatedAt: new Date() })
              .where(eq(users.id, session.userId));
          },
        },
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'rateLimit',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/forget-password': { window: 60 * 15, max: 3 },
        '/reset-password': { window: 60 * 15, max: 5 },
      },
    },
    advanced: {
      useSecureCookies,
      cookiePrefix: 'provider-tracker',
      defaultCookieAttributes: {
        httpOnly: true,
        secure: useSecureCookies,
        sameSite: 'lax',
        path: '/',
      },
      ipAddress: {
        ipAddressHeaders: config.AUTH_CLIENT_IP_HEADER ? [config.AUTH_CLIENT_IP_HEADER] : [],
        trustedProxies: config.AUTH_TRUSTED_PROXY_CIDRS,
      },
      database: {
        generateId: 'uuid',
      },
    },
    telemetry: { enabled: false },
  });
}

let authInstance: ReturnType<typeof buildAuth> | undefined;

export function getAuth(): ReturnType<typeof buildAuth> {
  authInstance ??= buildAuth();
  return authInstance;
}

export function createTrustedProvisioningAuth() {
  return buildAuth(true);
}

export type AuthSession = ReturnType<typeof buildAuth>['$Infer']['Session'];

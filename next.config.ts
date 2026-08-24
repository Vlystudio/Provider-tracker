import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_SERVER } from 'next/constants';
import { assertProductionConfiguration } from './src/server/config';

const isProduction = process.env.NODE_ENV === "production";

export const securityHeaders = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  },
  ...(isProduction
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

export const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ['127.0.0.1'],
  deploymentId:
    process.env.NEXT_DEPLOYMENT_ID || process.env.APP_RELEASE || process.env.BUILD_COMMIT || undefined,
  output: process.env.VERCEL ? undefined : 'standalone',
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  experimental: {
    proxyClientMaxBodySize: '50mb',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default function getNextConfig(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_SERVER) {
    assertProductionConfiguration(true);
  }
  return nextConfig;
}

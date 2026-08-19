export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionConfiguration } = await import('@/server/config');
    assertProductionConfiguration();
  }
}

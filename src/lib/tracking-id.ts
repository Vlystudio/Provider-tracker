const TRACKING_ID_PREFIX = 'PT-';

export function formatTrackingId(id: string): string {
  return `${TRACKING_ID_PREFIX}${id.toUpperCase()}`;
}

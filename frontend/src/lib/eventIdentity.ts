function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAssets(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => normalizeText(item)).filter(Boolean)
    : [];
}

function shortHash(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
  }
  return Math.abs(hash >>> 0).toString(36);
}

export interface EventIdentityInput {
  title?: string;
  desc?: string;
  assets?: string[];
  sourceUrl?: string;
  market?: string;
  timestamp?: string;
}

export function normalizeEventTimestamp(value: unknown): string {
  const text = normalizeText(value);
  if (!text) return new Date().toISOString();
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function buildStableEventId(input: EventIdentityInput, prefix = 'evt'): string {
  const market = normalizeText(input.market).toLowerCase() || 'global';
  const title = normalizeText(input.title);
  const timestamp = normalizeEventTimestamp(input.timestamp);
  const sourceUrl = normalizeText(input.sourceUrl);
  const desc = normalizeText(input.desc);
  const assets = normalizeAssets(input.assets).join('|');
  const raw = [market, title, timestamp, sourceUrl, assets, desc].join('::');
  return `${prefix}-${shortHash(raw)}`;
}

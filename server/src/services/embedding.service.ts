import crypto from 'crypto';
import { config } from '../config';
import type { CacheEntry } from '../types';

const embeddingCache = new Map<string, CacheEntry>();
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 50;

interface CloudflareEmbeddingResponse {
  success: boolean;
  errors?: Array<{ message?: string }>;
  result?: {
    data?: number[][];
  };
}

function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

function cacheKey(text: string): string {
  return crypto.createHash('sha256').update(normalizeText(text)).digest('hex');
}

function getCloudflareEmbeddingUrl(): string {
  return `https://api.cloudflare.com/client/v4/accounts/${config.cloudflare.accountId}/ai/run/${config.cloudflare.embeddingModel}`;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestEmbeddings(texts: string[]): Promise<number[][]> {
  const res = await fetch(getCloudflareEmbeddingUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cloudflare.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: texts }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloudflare embedding API failed: status=${res.status} body=${body}`);
  }

  const data = (await res.json()) as CloudflareEmbeddingResponse;
  if (!data.success) {
    const message = data.errors?.map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(`Cloudflare embedding returned success=false${message ? `: ${message}` : ''}`);
  }

  const embeddings = data.result?.data;
  if (!embeddings || embeddings.length !== texts.length) {
    throw new Error('Cloudflare embedding response did not include one vector per input text');
  }

  return embeddings;
}

export async function embedQuery(text: string): Promise<{
  vector: number[];
  cached: boolean;
  latency_ms: number;
}> {
  const start = Date.now();
  const key = cacheKey(text);
  const entry = embeddingCache.get(key);

  if (entry && Date.now() < entry.expires_at) {
    return { vector: entry.vector, cached: true, latency_ms: Date.now() - start };
  }

  if (entry) {
    embeddingCache.delete(key);
  }

  const [vector] = await requestEmbeddings([text]);
  if (!vector) {
    throw new Error('Cloudflare embedding response was empty');
  }

  embeddingCache.set(key, {
    vector,
    expires_at: Date.now() + config.retrieval.embeddingCacheTtlMs,
  });

  return { vector, cached: false, latency_ms: Date.now() - start };
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    results.push(...(await requestEmbeddings(batch)));

    if (i + BATCH_SIZE < texts.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  return results;
}

export function getCacheStats(): {
  size: number;
  ttl_ms: number;
} {
  const now = Date.now();

  for (const [key, entry] of embeddingCache.entries()) {
    if (entry.expires_at <= now) {
      embeddingCache.delete(key);
    }
  }

  return {
    size: embeddingCache.size,
    ttl_ms: config.retrieval.embeddingCacheTtlMs,
  };
}

import { config, getPineconeIndex } from '../config';
import type { DocumentMetadata, RetrievedChunk, VectorRecord } from '../types';

const UPSERT_BATCH_SIZE = 100;

interface PineconeMatch {
  id?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export async function upsertVectors(schoolId: string, vectors: VectorRecord[]): Promise<void> {
  const namespace = getPineconeIndex().namespace(schoolId);

  for (let i = 0; i < vectors.length; i += UPSERT_BATCH_SIZE) {
    await namespace.upsert({ records: vectors.slice(i, i + UPSERT_BATCH_SIZE) });
  }
}

export async function queryVectors(
  schoolId: string,
  vector: number[],
  filter: Record<string, unknown>,
  topK = config.retrieval.topK,
): Promise<{ chunks: RetrievedChunk[]; latency_ms: number }> {
  const start = Date.now();
  const namespace = getPineconeIndex().namespace(schoolId);
  const response = await namespace.query({
    vector,
    topK,
    includeMetadata: true,
    ...(Object.keys(filter).length > 0 ? { filter } : {}),
  });

  const matches = (response.matches ?? []) as PineconeMatch[];
  const chunks = matches
    .filter((match) => (match.score ?? 0) >= config.retrieval.relevanceThreshold)
    .map((match) => {
      const metadata = match.metadata ?? {};
      return {
        id: match.id ?? '',
        content: typeof metadata.content === 'string' ? metadata.content : '',
        metadata: metadata as unknown as DocumentMetadata,
        score: match.score ?? 0,
      };
    })
    .filter((chunk) => chunk.id && chunk.content);

  return {
    chunks,
    latency_ms: Date.now() - start,
  };
}

export async function checkPineconeConnection(): Promise<'connected' | 'unavailable'> {
  try {
    await getPineconeIndex().describeIndexStats();
    return 'connected';
  } catch {
    return 'unavailable';
  }
}

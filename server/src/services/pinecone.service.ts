import { config, getPineconeIndex } from '../config';
import type { DocumentMetadata, RetrievedChunk, VectorRecord } from '../types';

const UPSERT_BATCH_SIZE = 100;

interface PineconeMatch {
  id?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

interface CandidateChunk extends RetrievedChunk {
  original_doc_id?: string;
  chunk_index?: number;
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
  const candidates = matches
    .map((match): CandidateChunk => {
      const metadata = match.metadata ?? {};
      return {
        id: match.id ?? '',
        content: typeof metadata.content === 'string' ? metadata.content : '',
        metadata: metadata as unknown as DocumentMetadata,
        score: match.score ?? 0,
        ...(typeof metadata.original_doc_id === 'string'
          ? { original_doc_id: metadata.original_doc_id }
          : {}),
        ...(typeof metadata.chunk_index === 'number'
          ? { chunk_index: metadata.chunk_index }
          : {}),
      };
    })
    .filter((chunk) => chunk.id && chunk.content);

  const thresholded = candidates.filter(
    (chunk) => chunk.score >= config.retrieval.relevanceThreshold,
  );

  const keptIds = new Set(thresholded.map((chunk) => chunk.id));
  const chunks: CandidateChunk[] = [...thresholded];

  for (const keptChunk of thresholded) {
    if (!keptChunk.original_doc_id || typeof keptChunk.chunk_index !== 'number') {
      continue;
    }

    for (const candidate of candidates) {
      if (
        keptIds.has(candidate.id) ||
        candidate.original_doc_id !== keptChunk.original_doc_id ||
        typeof candidate.chunk_index !== 'number'
      ) {
        continue;
      }

      if (Math.abs(candidate.chunk_index - keptChunk.chunk_index) === 1) {
        keptIds.add(candidate.id);
        chunks.push(candidate);
      }
    }
  }

  return {
    chunks: chunks.map(({ id, content, metadata, score }) => ({
      id,
      content,
      metadata,
      score,
    })),
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

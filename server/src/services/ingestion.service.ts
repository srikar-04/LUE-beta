import type { DocumentMetadata, IngestDocument, IngestResult, VectorRecord } from '../types';
import { embedBatch } from './embedding.service';
import { upsertVectors } from './pinecone.service';
import { chunkText } from '../utils/chunker';

type FlatMetadata = Record<string, string | number | boolean | string[]>;

function flattenMetadata(metadata: DocumentMetadata): FlatMetadata {
  return {
    school_id: metadata.school_id,
    data_category: metadata.data_category,
    access_roles: metadata.access_roles,
    entity_type: metadata.entity_type,
    content_summary: metadata.content_summary,
    created_at: metadata.created_at,
    ...(metadata.student_id ? { student_id: metadata.student_id } : {}),
    ...(metadata.class_id ? { class_id: metadata.class_id } : {}),
    ...(metadata.teacher_id ? { teacher_id: metadata.teacher_id } : {}),
  };
}

export async function ingestDocuments(
  schoolId: string,
  documents: IngestDocument[],
): Promise<IngestResult> {
  const start = Date.now();
  const errors: string[] = [];

  const allChunks = documents.flatMap((doc) => {
    const chunks = chunkText(doc.content);
    if (chunks.length === 0) {
      errors.push(`Document ${doc.id}: content cannot be empty`);
    }

    return chunks.map((chunk) => ({
      id: `${doc.id}_chunk_${chunk.chunk_index}`,
      content: chunk.content,
      metadata: {
        ...flattenMetadata(doc.metadata),
        content: chunk.content,
        original_doc_id: doc.id,
        chunk_index: chunk.chunk_index,
      },
    }));
  });

  if (allChunks.length === 0) {
    return {
      success: false,
      ingested: 0,
      chunks_created: 0,
      latency_ms: Date.now() - start,
      errors,
    };
  }

  const embeddings = await embedBatch(allChunks.map((chunk) => chunk.content));

  const vectors: VectorRecord[] = allChunks.map((chunk, index) => {
    const values = embeddings[index];
    if (!values) {
      throw new Error(`Missing embedding for chunk ${chunk.id}`);
    }

    return {
      id: chunk.id,
      values,
      metadata: chunk.metadata,
    };
  });

  await upsertVectors(schoolId, vectors);

  const successfulDocIds = new Set(
    allChunks.map((chunk) => String(chunk.metadata.original_doc_id)),
  );

  return {
    success: errors.length === 0,
    ingested: successfulDocIds.size,
    chunks_created: allChunks.length,
    latency_ms: Date.now() - start,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

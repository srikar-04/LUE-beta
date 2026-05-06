import { Router } from 'express';
import { z } from 'zod';
import { ingestDocuments } from '../services/ingestion.service';
import type { IngestDocument } from '../types';

const metadataSchema = z.object({
  school_id: z.string().trim().min(1),
  data_category: z.enum(['general', 'academic', 'attendance', 'financial', 'personal']),
  access_roles: z.array(z.string().trim().min(1)).min(1),
  entity_type: z.string().trim().min(1),
  content_summary: z.string().trim().min(1),
  student_id: z.string().trim().min(1).optional(),
  class_id: z.string().trim().min(1).optional(),
  teacher_id: z.string().trim().min(1).optional(),
  created_at: z.number().int().nonnegative(),
});

const ingestRequestSchema = z.object({
  schoolId: z.string().trim().min(1),
  documents: z.array(
    z.object({
      id: z.string().trim().min(1),
      content: z.string().trim().min(1),
      metadata: metadataSchema,
    }),
  ).min(1),
});

export const ingestRouter = Router();

function normalizeDocuments(documents: z.infer<typeof ingestRequestSchema>['documents']): IngestDocument[] {
  return documents.map((doc) => ({
    id: doc.id,
    content: doc.content,
    metadata: {
      school_id: doc.metadata.school_id,
      data_category: doc.metadata.data_category,
      access_roles: doc.metadata.access_roles,
      entity_type: doc.metadata.entity_type,
      content_summary: doc.metadata.content_summary,
      created_at: doc.metadata.created_at,
      ...(doc.metadata.student_id ? { student_id: doc.metadata.student_id } : {}),
      ...(doc.metadata.class_id ? { class_id: doc.metadata.class_id } : {}),
      ...(doc.metadata.teacher_id ? { teacher_id: doc.metadata.teacher_id } : {}),
    },
  }));
}

ingestRouter.post('/', async (req, res, next) => {
  const parsed = ingestRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  try {
    const result = await ingestDocuments(
      parsed.data.schoolId,
      normalizeDocuments(parsed.data.documents),
    );
    res.status(result.success ? 200 : 207).json(result);
  } catch (err) {
    next(err);
  }
});

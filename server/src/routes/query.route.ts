import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { sessionParser } from '../middleware/sessionParser';
import { embedQuery } from '../services/embedding.service';
import { streamGeminiResponse } from '../services/llm.service';
import { queryVectors } from '../services/pinecone.service';
import { buildPineconeFilter } from '../utils/filterBuilder';
import { buildPrompt } from '../utils/promptBuilder';

const queryRequestSchema = z.object({
  query: z.string().trim().min(1),
  top_k: z.number().int().positive().max(20).optional(),
});

export const queryRouter = Router();

queryRouter.post('/', sessionParser, async (req, res, next) => {
  if (!req.session) {
    res.status(401).json({ error: 'Session not found' });
    return;
  }

  const parsed = queryRequestSchema.safeParse(req.body);
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

  const requestStart = Date.now();

  try {
    const filter = buildPineconeFilter(req.session);
    console.log(
      `[LUE] query_filter role=${req.session.role} school=${req.session.school_id} filter=${JSON.stringify(filter)}`,
    );

    const embedding = await embedQuery(parsed.data.query);
    console.log(
      `[LUE] step=embed school=${req.session.school_id} role=${req.session.role} cached=${embedding.cached} latency_ms=${embedding.latency_ms}`,
    );

    const retrieval = await queryVectors(
      req.session.school_id,
      embedding.vector,
      filter,
      parsed.data.top_k ?? config.retrieval.topK,
    );
    console.log(
      `[LUE] step=retrieve school=${req.session.school_id} role=${req.session.role} chunks=${retrieval.chunks.length} latency_ms=${retrieval.latency_ms}`,
    );

    const prompt = buildPrompt(req.session, parsed.data.query, retrieval.chunks);
    console.log(
      `[LUE] step=prompt school=${req.session.school_id} role=${req.session.role} chunks_used=${retrieval.chunks.length} total_pre_llm_ms=${Date.now() - requestStart}`,
    );

    await streamGeminiResponse(prompt.systemPrompt, prompt.userMessage, res, requestStart, {
      chunks_used: retrieval.chunks.length,
      embedding_cached: embedding.cached,
      retrieval_latency_ms: retrieval.latency_ms,
      embedding_latency_ms: embedding.latency_ms,
    });

    console.log(
      `[LUE] step=query_complete school=${req.session.school_id} role=${req.session.role} total_latency_ms=${Date.now() - requestStart}`,
    );
  } catch (err) {
    next(err);
  }
});

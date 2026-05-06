import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { schoolRateLimiter } from '../middleware/rateLimiter';
import { sessionParser } from '../middleware/sessionParser';
import { embedQuery } from '../services/embedding.service';
import { prepareSse, streamGeminiResponse, writeSseError } from '../services/llm.service';
import { queryVectors } from '../services/pinecone.service';
import { buildPineconeFilter } from '../utils/filterBuilder';
import { logError, logEvent, requestLogFields } from '../utils/logger';
import { buildPrompt } from '../utils/promptBuilder';

const queryRequestSchema = z.object({
  query: z.string().trim().min(1),
  top_k: z.number().int().positive().max(20).optional(),
});

export const queryRouter = Router();

queryRouter.post('/', sessionParser, schoolRateLimiter, async (req, res, next) => {
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
  const logContext = requestLogFields(req);

  try {
    const filter = buildPineconeFilter(req.session);
    logEvent({
      ...logContext,
      step: 'filter',
      latency_ms: 0,
      filter: JSON.stringify(filter),
    });

    let embedding;
    try {
      embedding = await embedQuery(parsed.data.query);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Embedding request failed';
      prepareSse(res);
      writeSseError(res, message);
      logError({
        ...logContext,
        step: 'embed_error',
        latency_ms: Date.now() - requestStart,
        error: message,
      });
      return;
    }

    logEvent({
      ...logContext,
      step: 'embed',
      latency_ms: embedding.latency_ms,
      cached: embedding.cached,
    });

    let retrieval;
    try {
      retrieval = await queryVectors(
        req.session.school_id,
        embedding.vector,
        filter,
        parsed.data.top_k ?? config.retrieval.topK,
      );
      logEvent({
        ...logContext,
        step: 'retrieve',
        latency_ms: retrieval.latency_ms,
        chunks: retrieval.chunks.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Pinecone retrieval failed';
      retrieval = {
        chunks: [],
        latency_ms: Date.now() - requestStart,
      };
      logError({
        ...logContext,
        step: 'retrieve_error',
        latency_ms: retrieval.latency_ms,
        error: message,
      });
    }

    const prompt = buildPrompt(req.session, parsed.data.query, retrieval.chunks);
    logEvent({
      ...logContext,
      step: 'prompt',
      latency_ms: Date.now() - requestStart,
      chunks_used: retrieval.chunks.length,
    });

    await streamGeminiResponse(prompt.systemPrompt, prompt.userMessage, res, requestStart, logContext, {
      chunks_used: retrieval.chunks.length,
      embedding_cached: embedding.cached,
      retrieval_latency_ms: retrieval.latency_ms,
      embedding_latency_ms: embedding.latency_ms,
    });

    logEvent({
      ...logContext,
      step: 'query_complete',
      latency_ms: Date.now() - requestStart,
      chunks_used: retrieval.chunks.length,
      embedding_cached: embedding.cached,
      retrieval_latency_ms: retrieval.latency_ms,
      embedding_latency_ms: embedding.latency_ms,
    });
  } catch (err) {
    next(err);
  }
});

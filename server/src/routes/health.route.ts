import { Router } from 'express';
import { config } from '../config';
import { sessionParser } from '../middleware/sessionParser';
import { buildPineconeFilter } from '../utils/filterBuilder';

const startedAt = Date.now();
export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    services: {
      pinecone: {
        configured: Boolean(config.pinecone.apiKey),
        index_name: config.pinecone.indexName,
      },
      cloudflare: {
        configured: Boolean(config.cloudflare.accountId && config.cloudflare.apiToken),
        embedding_model: config.cloudflare.embeddingModel,
      },
      gemini: {
        configured: Boolean(config.gemini.apiKey),
        model: config.gemini.model,
      },
    },
    uptime_ms: Date.now() - startedAt,
    retrieval_settings: {
      top_k: config.retrieval.topK,
      relevance_threshold: config.retrieval.relevanceThreshold,
      embedding_dimension: config.retrieval.embeddingDimension,
      cache_ttl_ms: config.retrieval.embeddingCacheTtlMs,
    },
  });
});

healthRouter.get('/auth', sessionParser, (req, res) => {
  if (!req.session) {
    res.status(401).json({ error: 'Session not found' });
    return;
  }

  const filter = buildPineconeFilter(req.session);
  console.log(`[LUE] auth_filter role=${req.session.role} filter=${JSON.stringify(filter)}`);

  res.status(200).json({
    status: 'ok',
    session: req.session,
  });
});

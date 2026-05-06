import { Router } from 'express';
import { config } from '../config';
import { sessionParser } from '../middleware/sessionParser';
import { getCacheStats } from '../services/embedding.service';
import { checkPineconeConnection } from '../services/pinecone.service';
import { buildPineconeFilter } from '../utils/filterBuilder';
import { logEvent, requestLogFields } from '../utils/logger';

const startedAt = Date.now();
export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const cacheStats = getCacheStats();
  const pineconeStatus = await checkPineconeConnection();

  res.status(200).json({
    status: 'ok',
    pinecone: pineconeStatus,
    cloudflare: Boolean(config.cloudflare.accountId && config.cloudflare.apiToken)
      ? 'configured'
      : 'missing',
    gemini: Boolean(config.gemini.apiKey) ? 'configured' : 'missing',
    embedding_cache_size: cacheStats.size,
    cache_ttl_ms: cacheStats.ttl_ms,
    service_names: {
      pinecone_index: config.pinecone.indexName,
      cloudflare_embedding_model: config.cloudflare.embeddingModel,
      gemini_model: config.gemini.model,
    },
    uptime_ms: Date.now() - startedAt,
    retrieval_settings: {
      top_k: config.retrieval.topK,
      relevance_threshold: config.retrieval.relevanceThreshold,
      embedding_dimension: config.retrieval.embeddingDimension,
      cache_ttl_ms: config.retrieval.embeddingCacheTtlMs,
    },
    rate_limit: {
      requests_per_minute: config.rateLimit.requestsPerMinute,
      window_ms: config.rateLimit.windowMs,
    },
  });
});

healthRouter.get('/auth', sessionParser, (req, res) => {
  if (!req.session) {
    res.status(401).json({ error: 'Session not found' });
    return;
  }

  const filter = buildPineconeFilter(req.session);
  logEvent({
    ...requestLogFields(req),
    step: 'auth_filter',
    latency_ms: 0,
    filter: JSON.stringify(filter),
  });

  res.status(200).json({
    status: 'ok',
    session: req.session,
  });
});

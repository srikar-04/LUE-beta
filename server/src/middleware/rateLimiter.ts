import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { logEvent, requestLogFields } from '../utils/logger';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function schoolRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const schoolId = req.session?.school_id;

  if (!schoolId) {
    next();
    return;
  }

  const now = Date.now();
  const existing = buckets.get(schoolId);

  if (!existing || existing.resetAt <= now) {
    buckets.set(schoolId, {
      count: 1,
      resetAt: now + config.rateLimit.windowMs,
    });
    next();
    return;
  }

  existing.count += 1;

  if (existing.count > config.rateLimit.requestsPerMinute) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    logEvent({
      ...requestLogFields(req),
      step: 'rate_limit',
      latency_ms: 0,
      limit: config.rateLimit.requestsPerMinute,
      retry_after_seconds: retryAfterSeconds,
      school_id: schoolId,
    });
    res.status(429).json({ error: 'Rate limit exceeded for this school' });
    return;
  }

  next();
}

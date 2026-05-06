import type { NextFunction, Request, Response } from 'express';
import { logEvent, requestLogFields } from '../utils/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const latencyMs = Date.now() - start;
    logEvent({
      ...requestLogFields(req),
      step: 'request',
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      latency_ms: latencyMs,
    });
  });

  next();
}

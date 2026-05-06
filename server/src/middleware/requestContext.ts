import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

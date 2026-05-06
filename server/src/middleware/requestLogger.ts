import type { NextFunction, Request, Response } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const latencyMs = Date.now() - start;
    console.log(
      `[LUE] method=${req.method} path=${req.originalUrl} status=${res.statusCode} latency=${latencyMs}ms`,
    );
  });

  next();
}

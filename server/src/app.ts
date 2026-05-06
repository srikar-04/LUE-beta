import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config';
import { requestContext } from './middleware/requestContext';
import { requestLogger } from './middleware/requestLogger';
import { healthRouter } from './routes/health.route';
import { ingestRouter } from './routes/ingest.route';
import { queryRouter } from './routes/query.route';
import { logError, logEvent, requestLogFields } from './utils/logger';

export const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(requestContext);
app.use(requestLogger);

app.use('/api/health', healthRouter);
app.use('/api/ingest', ingestRouter);
app.use('/api/query', queryRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal server error';
  logError({
    ...requestLogFields(_req),
    step: 'unhandled_error',
    latency_ms: 0,
    error: message,
  });
  res.status(500).json({ error: message });
});

if (require.main === module) {
  app.listen(config.port, () => {
    logEvent({
      request_id: null,
      school_id: null,
      role: null,
      step: 'server_start',
      latency_ms: 0,
      port: config.port,
    });
  });
}

// app.listen(config.port, () => {
//   console.log(`[LUE] server listening on port ${config.port}`);
// });
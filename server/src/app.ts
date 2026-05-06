import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config';
import { requestLogger } from './middleware/requestLogger';
import { healthRouter } from './routes/health.route';

export const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(requestLogger);

app.use('/api/health', healthRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('[LUE] unhandled_error', err);
  res.status(500).json({ error: message });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`[LUE] server listening on port ${config.port}`);
  });
}

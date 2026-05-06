import type { SessionContext } from './index';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      session?: SessionContext;
    }
  }
}

export {};

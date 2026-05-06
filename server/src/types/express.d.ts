import type { SessionContext } from './index';

declare global {
  namespace Express {
    interface Request {
      session?: SessionContext;
    }
  }
}

export {};

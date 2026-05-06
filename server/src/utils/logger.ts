import type { Request } from 'express';

type LogValue = boolean | number | string | string[] | null | undefined;
type LogFields = Record<string, LogValue>;
export interface RequestLogContext {
  request_id: string | null;
  school_id: string | null;
  role: string | null;
}

function normalizeFields(fields: LogFields): Record<string, boolean | number | string | string[] | null> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Record<string, boolean | number | string | string[] | null>;
}

export function logEvent(fields: LogFields): void {
  console.log(JSON.stringify(normalizeFields(fields)));
}

export function logError(fields: LogFields): void {
  console.error(JSON.stringify(normalizeFields(fields)));
}

export function requestLogFields(req: Request): RequestLogContext {
  return {
    request_id: req.requestId ?? null,
    school_id: req.session?.school_id ?? null,
    role: req.session?.role ?? null,
  };
}

import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { SessionContext } from '../types';

const baseSessionSchema = z.object({
  school_id: z.string().trim().min(1, 'school_id is required'),
  user_id: z.string().trim().min(1, 'user_id is required'),
  role: z.enum(['admin', 'teacher', 'parent', 'student']),
  name: z.string().trim().min(1, 'name is required'),
  teacher_id: z.string().trim().min(1).optional(),
  class_ids: z.array(z.string().trim().min(1)).optional(),
  student_id: z.string().trim().min(1).optional(),
  parent_id: z.string().trim().min(1).optional(),
  student_ids: z.array(z.string().trim().min(1)).optional(),
});

function validateSession(raw: unknown): SessionContext {
  const session = baseSessionSchema.parse(raw);

  if (session.role === 'teacher' && (!session.class_ids || session.class_ids.length === 0)) {
    throw new Error('class_ids is required for teacher sessions');
  }

  if (session.role === 'student' && !session.student_id) {
    throw new Error('student_id is required for student sessions');
  }

  if (session.role === 'parent' && (!session.student_ids || session.student_ids.length === 0)) {
    throw new Error('student_ids is required for parent sessions');
  }

  return {
    school_id: session.school_id,
    user_id: session.user_id,
    role: session.role,
    name: session.name,
    ...(session.teacher_id ? { teacher_id: session.teacher_id } : {}),
    ...(session.class_ids ? { class_ids: session.class_ids } : {}),
    ...(session.student_id ? { student_id: session.student_id } : {}),
    ...(session.parent_id ? { parent_id: session.parent_id } : {}),
    ...(session.student_ids ? { student_ids: session.student_ids } : {}),
  };
}

export function sessionParser(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or malformed Authorization header' });
      return;
    }

    const token = authHeader.slice('Bearer '.length).trim();

    if (!token) {
      res.status(401).json({ error: 'Missing bearer token' });
      return;
    }

    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const raw = JSON.parse(decoded) as unknown;

    req.session = validateSession(raw);
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid session token';
    res.status(401).json({ error: `Session parse error: ${message}` });
  }
}

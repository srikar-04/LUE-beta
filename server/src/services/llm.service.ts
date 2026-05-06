import type { Response } from 'express';
import { config, getOpenAIClient } from '../config';
import { logError, type RequestLogContext } from '../utils/logger';

export function prepareSse(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

export function writeSseEvent(res: Response, payload: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function writeSseError(res: Response, message: string): void {
  writeSseEvent(res, { error: message });
  res.end();
}

export async function streamGeminiResponse(
  systemPrompt: string,
  userMessage: string,
  res: Response,
  requestStart: number,
  logContext: RequestLogContext,
  metadata: {
    chunks_used: number;
    embedding_cached: boolean;
    retrieval_latency_ms: number;
    embedding_latency_ms: number;
  },
): Promise<void> {
  prepareSse(res);

  try {
    const stream = await getOpenAIClient().chat.completions.create({
      model: config.gemini.model,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    writeSseEvent(res, {
      done: true,
      latency_ms: Date.now() - requestStart,
      ...metadata,
    });
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LLM error';
    writeSseError(res, message);
    logError({
      ...logContext,
      step: 'llm_error',
      latency_ms: Date.now() - requestStart,
      error: message,
    });
  }
}

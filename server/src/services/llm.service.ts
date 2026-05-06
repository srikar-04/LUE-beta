import type { Response } from 'express';
import { config, getOpenAIClient } from '../config';

export async function streamGeminiResponse(
  systemPrompt: string,
  userMessage: string,
  res: Response,
  requestStart: number,
  metadata: {
    chunks_used: number;
    embedding_cached: boolean;
    retrieval_latency_ms: number;
    embedding_latency_ms: number;
  },
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

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

    res.write(
      `data: ${JSON.stringify({
        done: true,
        latency_ms: Date.now() - requestStart,
        ...metadata,
      })}\n\n`,
    );
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LLM error';
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
    console.error(`[LUE] LLM streaming error: ${message}`);
  }
}

import type { RetrievedChunk, SessionContext, UserRole } from '../types';

export function buildPrompt(
  session: SessionContext,
  query: string,
  chunks: RetrievedChunk[],
): { systemPrompt: string; userMessage: string } {
  const roleContext: Record<UserRole, string> = {
    admin:
      `You are speaking to ${session.name}, a school administrator with full access to all school records. ` +
      'Provide complete, accurate information in a professional tone.',
    teacher:
      `You are speaking to ${session.name}, a teacher responsible for classes: ${session.class_ids?.join(', ')}. ` +
      'You only have access to data for their assigned classes.',
    parent:
      `You are speaking to ${session.name}, a parent. ` +
      'You can only see information about their own child. Be warm and clear.',
    student:
      `You are speaking to ${session.name}, a student. ` +
      'You can only see your own academic information. Be friendly and encouraging.',
  };

  const systemPrompt =
    'You are LUE, the intelligent assistant for the Light Up Education school management platform.\n\n' +
    `${roleContext[session.role]}\n\n` +
    'STRICT RULES:\n' +
    '1. Answer ONLY from the provided context. Never fabricate or guess.\n' +
    '2. If the context does not contain the answer, say: "I don\'t have that information available right now."\n' +
    '3. Never reveal any data about other students, teachers, or financial records beyond what is in the context.\n' +
    '4. Keep answers concise and directly relevant to the question.\n' +
    '5. If a question is outside school management scope, politely decline.';

  const contextBlock =
    chunks.length > 0
      ? chunks.map((chunk, index) => `[Source ${index + 1}]\n${chunk.content}`).join('\n\n')
      : 'No relevant information was found in the school database for this query.';

  const userMessage = `CONTEXT:\n${contextBlock}\n\nQUESTION:\n${query}`;

  return { systemPrompt, userMessage };
}

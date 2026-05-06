const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 50;
const MIN_CHUNK_LENGTH = 20;

export interface TextChunk {
  content: string;
  chunk_index: number;
}

export function chunkText(text: string): TextChunk[] {
  const cleaned = text.trim().replace(/\s+/g, ' ');

  if (!cleaned) {
    return [];
  }

  if (cleaned.length <= CHUNK_SIZE) {
    return [{ content: cleaned, chunk_index: 0 }];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < cleaned.length) {
    let end = Math.min(start + CHUNK_SIZE, cleaned.length);

    if (end < cleaned.length) {
      const sentenceBreak = Math.max(
        cleaned.lastIndexOf('. ', end),
        cleaned.lastIndexOf('! ', end),
        cleaned.lastIndexOf('? ', end),
      );
      const wordBreak = cleaned.lastIndexOf(' ', end);

      if (sentenceBreak > start + CHUNK_SIZE / 2) {
        end = sentenceBreak + 1;
      } else if (wordBreak > start) {
        end = wordBreak;
      }
    }

    const content = cleaned.slice(start, end).trim();
    if (content.length > MIN_CHUNK_LENGTH) {
      chunks.push({ content, chunk_index: chunkIndex });
      chunkIndex += 1;
    }

    if (end >= cleaned.length) {
      break;
    }

    start = Math.max(0, end - CHUNK_OVERLAP);
  }

  return chunks;
}

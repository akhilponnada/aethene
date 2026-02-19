/**
 * Chunking Service - Simple document chunking for Aethene
 *
 * Splits documents into manageable chunks for vector storage.
 * Uses paragraph-based splitting with configurable sizes.
 */

export interface ChunkOptions {
  chunkSize?: number;      // Target chunk size in chars (default: 500)
  maxChunkSize?: number;   // Maximum chunk size (default: 1000)
  minChunkSize?: number;   // Minimum chunk size (default: 100)
  overlap?: number;        // Overlap between chunks (default: 50)
}

export interface Chunk {
  content: string;
  index: number;
  startChar: number;
  endChar: number;
}

/**
 * Split text into paragraphs
 */
function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n|\n(?=#)/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Chunk text into segments
 */
export function chunkText(
  text: string,
  options: ChunkOptions = {}
): string[] {
  const {
    chunkSize = 500,
    maxChunkSize = 1000,
    minChunkSize = 100,
    overlap = 50
  } = options;

  if (!text || text.length < minChunkSize) {
    return text ? [text.trim()] : [];
  }

  const paragraphs = splitIntoParagraphs(text);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    // If adding this paragraph exceeds max size, save current chunk
    if (currentChunk.length + paragraph.length > maxChunkSize && currentChunk.length >= minChunkSize) {
      chunks.push(currentChunk.trim());

      // Start new chunk with overlap
      const overlapText = currentChunk.slice(-overlap);
      currentChunk = overlapText + '\n\n' + paragraph;
    } else {
      // Add to current chunk
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  // Save final chunk
  if (currentChunk.trim().length >= minChunkSize) {
    chunks.push(currentChunk.trim());
  } else if (currentChunk.trim().length > 0 && chunks.length > 0) {
    // Append small final chunk to previous
    chunks[chunks.length - 1] += '\n\n' + currentChunk.trim();
  } else if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Chunk text with detailed metadata
 */
export function chunkTextWithMetadata(
  text: string,
  options: ChunkOptions = {}
): Chunk[] {
  const {
    chunkSize = 500,
    maxChunkSize = 1000,
    minChunkSize = 100,
    overlap = 50
  } = options;

  if (!text || text.length < minChunkSize) {
    return text ? [{
      content: text.trim(),
      index: 0,
      startChar: 0,
      endChar: text.length
    }] : [];
  }

  const paragraphs = splitIntoParagraphs(text);
  const chunks: Chunk[] = [];
  let currentChunk = '';
  let currentStartChar = 0;
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > maxChunkSize && currentChunk.length >= minChunkSize) {
      const startChar = text.indexOf(currentChunk.trim());
      chunks.push({
        content: currentChunk.trim(),
        index: chunkIndex++,
        startChar: startChar >= 0 ? startChar : currentStartChar,
        endChar: startChar >= 0 ? startChar + currentChunk.trim().length : currentStartChar + currentChunk.length
      });

      const overlapText = currentChunk.slice(-overlap);
      currentChunk = overlapText + '\n\n' + paragraph;
      currentStartChar += currentChunk.length - overlap;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  // Save final chunk
  if (currentChunk.trim().length >= minChunkSize) {
    const startChar = text.indexOf(currentChunk.trim());
    chunks.push({
      content: currentChunk.trim(),
      index: chunkIndex,
      startChar: startChar >= 0 ? startChar : currentStartChar,
      endChar: startChar >= 0 ? startChar + currentChunk.trim().length : currentStartChar + currentChunk.length
    });
  }

  return chunks;
}

/**
 * Split by sentences (alternative chunking strategy)
 */
export function chunkBySentences(
  text: string,
  sentencesPerChunk: number = 5
): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: string[] = [];

  for (let i = 0; i < sentences.length; i += sentencesPerChunk) {
    const chunk = sentences.slice(i, i + sentencesPerChunk).join(' ').trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

export const ChunkingService = {
  chunkText,
  chunkTextWithMetadata,
  chunkBySentences
};

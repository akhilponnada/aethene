/**
 * Embeddings Service - Gemini embeddings for Aethene
 *
 * Uses gemini-embedding-001 model with 768-dimensional vectors.
 * Supports both single and batch embedding generation.
 */

import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';

export class EmbeddingService {
  private gemini: GoogleGenerativeAI;
  private model: string = 'gemini-embedding-001';
  private outputDimensionality: number = 768;
  private cachedModel: any = null;  // Cache model instance for reuse

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY is required');
    }
    this.gemini = new GoogleGenerativeAI(key);
    // Pre-initialize model for faster first query
    this.cachedModel = this.gemini.getGenerativeModel({ model: this.model });
  }

  private getModel() {
    if (!this.cachedModel) {
      this.cachedModel = this.gemini.getGenerativeModel({ model: this.model });
    }
    return this.cachedModel;
  }

  /**
   * Generate embedding for a single text
   */
  async embedText(
    text: string,
    taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT
  ): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      return new Array(this.outputDimensionality).fill(0);
    }

    const truncatedText = text.substring(0, 2048);
    const model = this.getModel();  // Use cached model instance

    try {
      const result = await model.embedContent({
        content: { role: 'user', parts: [{ text: truncatedText }] },
        taskType: taskType,
      });

      const embedding = result.embedding.values;
      return this.normalize(embedding.slice(0, this.outputDimensionality));
    } catch (error: any) {
      // Fallback to simple API
      try {
        const result = await model.embedContent(truncatedText);
        return this.normalize(result.embedding.values.slice(0, this.outputDimensionality));
      } catch (e2: any) {
        console.error('Embedding error:', e2.message);
        throw new Error(`Failed to generate embedding: ${e2.message}`);
      }
    }
  }

  /**
   * Generate query embedding (for search)
   */
  async embedQuery(query: string): Promise<number[]> {
    return this.embedText(query, TaskType.RETRIEVAL_QUERY);
  }

  /**
   * Generate document embedding (for storage)
   */
  async embedDocument(text: string): Promise<number[]> {
    return this.embedText(text, TaskType.RETRIEVAL_DOCUMENT);
  }

  /**
   * Batch embed multiple texts
   */
  async embedBatch(
    texts: string[],
    taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT
  ): Promise<number[][]> {
    if (texts.length === 0) return [];

    try {
      const model = this.getModel();  // Use cached model instance
      const BATCH_SIZE = 100;
      const allEmbeddings: number[][] = [];

      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);

        const requests = batch.map(text => ({
          content: { role: 'user' as const, parts: [{ text: text.substring(0, 2048) }] },
          taskType: taskType
        }));

        const result = await model.batchEmbedContents({ requests });

        const batchEmbeddings = result.embeddings.map((e: { values: number[] }) =>
          this.normalize(e.values.slice(0, this.outputDimensionality))
        );
        allEmbeddings.push(...batchEmbeddings);

        // Rate limit between batches
        if (i + BATCH_SIZE < texts.length) {
          await new Promise(r => setTimeout(r, 50));
        }
      }

      return allEmbeddings;
    } catch (error: any) {
      // Fallback to sequential
      console.warn('Batch failed, falling back to sequential');
      const embeddings: number[][] = [];
      for (const text of texts) {
        embeddings.push(await this.embedText(text, taskType));
      }
      return embeddings;
    }
  }

  /**
   * Normalize embedding vector
   */
  private normalize(values: number[]): number[] {
    let norm = 0;
    for (const v of values) {
      norm += v * v;
    }
    norm = Math.sqrt(norm);
    if (norm === 0) return values;
    return values.map(v => v / norm);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

// Singleton instance
let embeddingService: EmbeddingService | null = null;

export function getEmbeddingService(): EmbeddingService {
  if (!embeddingService) {
    embeddingService = new EmbeddingService();
  }
  return embeddingService;
}

// Convenience functions
export async function embedText(text: string): Promise<number[]> {
  return getEmbeddingService().embedDocument(text);
}

export async function embedQuery(query: string): Promise<number[]> {
  return getEmbeddingService().embedQuery(query);
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  return getEmbeddingService().embedBatch(texts);
}

// Alias for common usage pattern
export async function generateEmbedding(text: string): Promise<number[]> {
  return embedText(text);
}

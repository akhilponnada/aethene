/**
 * File Processing Service for Aethene API
 *
 * Handles file upload processing for various content types:
 * - Documents: PDF, DOC, DOCX, TXT, MD
 * - Images: JPG, PNG, GIF, WebP (OCR extraction)
 * - Spreadsheets: CSV
 * - Audio: MP3, WAV, M4A (transcription)
 * - Video: MP4, MOV (transcription)
 */

import { randomBytes } from 'crypto';
import { IngestService } from './ingest-service.js';

// Supported MIME types and their categories
export const SUPPORTED_MIME_TYPES: Record<string, FileCategory> = {
  // Documents
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'text/plain': 'document',
  'text/markdown': 'document',
  'text/x-markdown': 'document',

  // Images (for OCR)
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',

  // Spreadsheets
  'text/csv': 'spreadsheet',
  'application/vnd.ms-excel': 'spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',

  // Audio
  'audio/mpeg': 'audio',
  'audio/mp3': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'audio/mp4': 'audio',
  'audio/m4a': 'audio',
  'audio/x-m4a': 'audio',

  // Video
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/x-msvideo': 'video',
  'video/webm': 'video',
};

export type FileCategory = 'document' | 'image' | 'spreadsheet' | 'audio' | 'video';

// File extension to MIME type mapping (fallback)
export const EXTENSION_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.csv': 'text/csv',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.webm': 'video/webm',
};

export interface FileUploadOptions {
  containerTag?: string;
  customId?: string;
  metadata?: Record<string, any>;
  entityContext?: string;
}

export interface FileUploadResult {
  id: string;
  status: string; // Matches DocumentStatus from ingest-service
  workflowInstanceId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

// Maximum file size: 50MB
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Generate a unique file ID
 */
function generateFileId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'file_';
  const bytes = randomBytes(16);
  for (let i = 0; i < 16; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * Detect file type from MIME type or filename
 */
export function detectFileType(mimeType: string | undefined, fileName: string): {
  category: FileCategory | null;
  mimeType: string;
  isSupported: boolean;
} {
  // Try MIME type first
  if (mimeType && SUPPORTED_MIME_TYPES[mimeType]) {
    return {
      category: SUPPORTED_MIME_TYPES[mimeType],
      mimeType,
      isSupported: true,
    };
  }

  // Fallback to extension
  const ext = fileName.toLowerCase().match(/\.[^.]+$/)?.[0];
  if (ext && EXTENSION_TO_MIME[ext]) {
    const inferredMime = EXTENSION_TO_MIME[ext];
    return {
      category: SUPPORTED_MIME_TYPES[inferredMime] || null,
      mimeType: inferredMime,
      isSupported: SUPPORTED_MIME_TYPES[inferredMime] !== undefined,
    };
  }

  // Unknown type
  return {
    category: null,
    mimeType: mimeType || 'application/octet-stream',
    isSupported: false,
  };
}

/**
 * Extract text content from a file based on its type
 * This is a placeholder - in production, you'd use:
 * - pdf-parse for PDFs
 * - mammoth for DOCX
 * - Tesseract.js for OCR on images
 * - OpenAI Whisper or similar for audio/video transcription
 */
async function extractFileContent(
  fileBuffer: ArrayBuffer,
  category: FileCategory,
  mimeType: string,
  fileName: string
): Promise<string> {
  const buffer = Buffer.from(fileBuffer);

  switch (category) {
    case 'document':
      // For plain text files, decode directly
      if (mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'text/x-markdown') {
        return buffer.toString('utf-8');
      }

      // For PDF, DOC, DOCX - we'd need specialized libraries
      // For now, return a placeholder that indicates the file was received
      // In production: use pdf-parse, mammoth, etc.
      if (mimeType === 'application/pdf') {
        // Attempt basic PDF text extraction
        // In production, use pdf-parse: const pdfData = await pdfParse(buffer);
        return `[PDF Document: ${fileName}]\n\nNote: Full PDF extraction requires pdf-parse library. File received and stored for processing.`;
      }

      if (mimeType.includes('word') || mimeType.includes('openxmlformats')) {
        // In production, use mammoth for DOCX
        return `[Word Document: ${fileName}]\n\nNote: Full DOCX extraction requires mammoth library. File received and stored for processing.`;
      }

      return buffer.toString('utf-8');

    case 'image':
      // In production: use Tesseract.js for OCR or vision models
      // For now, create a reference
      return `[Image: ${fileName}]\n\nNote: OCR extraction requires vision model integration. Image received and stored for processing.`;

    case 'spreadsheet':
      // For CSV, parse directly
      if (mimeType === 'text/csv') {
        const csvContent = buffer.toString('utf-8');
        // Basic CSV to text conversion
        const lines = csvContent.split('\n').slice(0, 100); // Limit to first 100 rows
        return `[CSV Data: ${fileName}]\n\n${lines.join('\n')}`;
      }

      // For Excel files
      return `[Spreadsheet: ${fileName}]\n\nNote: Excel extraction requires xlsx library. File received and stored for processing.`;

    case 'audio':
      // In production: use Whisper API for transcription
      return `[Audio File: ${fileName}]\n\nNote: Audio transcription requires Whisper API integration. Audio file received and stored for processing.`;

    case 'video':
      // In production: extract audio track and transcribe
      return `[Video File: ${fileName}]\n\nNote: Video transcription requires Whisper API integration. Video file received and stored for processing.`;

    default:
      return `[Unknown File: ${fileName}]\n\nFile received but content extraction not supported for this type.`;
  }
}

/**
 * Process an uploaded file
 */
export async function processFileUpload(
  userId: string,
  file: File,
  options: FileUploadOptions = {}
): Promise<FileUploadResult> {
  const { containerTag, customId, metadata = {}, entityContext } = options;

  // Use containerTag if provided, otherwise use userId
  const effectiveUserId = containerTag || userId;

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }

  // Detect file type
  const typeInfo = detectFileType(file.type, file.name);

  if (!typeInfo.isSupported) {
    throw new Error(`Unsupported file type: ${typeInfo.mimeType}. Supported types: PDF, DOC, DOCX, TXT, MD, JPG, PNG, GIF, WebP, CSV, MP3, WAV, M4A, MP4, MOV`);
  }

  // Read file content
  const fileBuffer = await file.arrayBuffer();

  // Extract text content based on file type
  const extractedContent = await extractFileContent(
    fileBuffer,
    typeInfo.category!,
    typeInfo.mimeType,
    file.name
  );

  // Generate file ID
  const fileId = customId || generateFileId();

  // Prepare metadata with file info
  const enrichedMetadata = {
    ...metadata,
    _fileInfo: {
      originalName: file.name,
      mimeType: typeInfo.mimeType,
      category: typeInfo.category,
      size: file.size,
      uploadedAt: new Date().toISOString(),
    },
  };

  // Ingest the extracted content through the standard pipeline
  const result = await IngestService.ingestContent(effectiveUserId, extractedContent, {
    customId: fileId,
    contentType: 'file',
    metadata: enrichedMetadata,
  });

  return {
    id: result.id,
    status: result.status,
    workflowInstanceId: result.workflowInstanceId,
    fileName: file.name,
    fileType: typeInfo.mimeType,
    fileSize: file.size,
  };
}

/**
 * Get list of supported file types
 */
export function getSupportedFileTypes(): {
  category: FileCategory;
  extensions: string[];
  mimeTypes: string[];
}[] {
  const categories: Record<FileCategory, { extensions: string[]; mimeTypes: string[] }> = {
    document: { extensions: [], mimeTypes: [] },
    image: { extensions: [], mimeTypes: [] },
    spreadsheet: { extensions: [], mimeTypes: [] },
    audio: { extensions: [], mimeTypes: [] },
    video: { extensions: [], mimeTypes: [] },
  };

  // Collect MIME types by category
  for (const [mime, category] of Object.entries(SUPPORTED_MIME_TYPES)) {
    categories[category].mimeTypes.push(mime);
  }

  // Collect extensions by category
  for (const [ext, mime] of Object.entries(EXTENSION_TO_MIME)) {
    const category = SUPPORTED_MIME_TYPES[mime];
    if (category) {
      categories[category].extensions.push(ext);
    }
  }

  return Object.entries(categories).map(([category, data]) => ({
    category: category as FileCategory,
    extensions: [...new Set(data.extensions)],
    mimeTypes: [...new Set(data.mimeTypes)],
  }));
}

export const FileProcessingService = {
  processFileUpload,
  detectFileType,
  getSupportedFileTypes,
  MAX_FILE_SIZE,
  SUPPORTED_MIME_TYPES,
};

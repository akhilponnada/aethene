/**
 * URL Fetch Service - Auto-fetch and extract content from URLs
 *
 * Features:
 * - URL detection in content
 * - Web page fetching with timeout/size limits
 * - HTML to text extraction (strips nav, ads, boilerplate)
 * - YouTube URL handling (video ID extraction, transcript fetching)
 * - Content type auto-detection
 */

// =============================================================================
// TYPES
// =============================================================================

export interface UrlFetchResult {
  success: boolean;
  content: string;
  title?: string;
  description?: string;
  contentType: 'webpage' | 'youtube' | 'pdf' | 'image' | 'video' | 'audio' | 'unknown';
  url: string;
  originalUrl: string;
  metadata: {
    fetchedAt: number;
    contentLength?: number;
    statusCode?: number;
    responseType?: string;
    youtubeVideoId?: string;
    pageTitle?: string;
    pageDescription?: string;
    ogImage?: string;
  };
  error?: string;
}

export interface UrlFetchOptions {
  timeout?: number;       // Timeout in ms (default: 30000)
  maxSize?: number;       // Max content size in bytes (default: 10MB)
  followRedirects?: boolean;
  userAgent?: string;
  extractMetadata?: boolean;
}

// =============================================================================
// URL DETECTION
// =============================================================================

/**
 * URL regex pattern that matches common URL formats
 */
const URL_PATTERN = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)/gi;

/**
 * YouTube URL patterns for various formats
 */
const YOUTUBE_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
];

/**
 * Check if a string is a valid URL
 */
export function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Detect if content is a URL or contains URLs
 */
export function detectUrls(content: string): string[] {
  const trimmed = content.trim();

  // First check if the entire content is a single URL
  if (isValidUrl(trimmed)) {
    return [trimmed];
  }

  // Find all URLs in the content
  const matches = trimmed.match(URL_PATTERN);
  return matches ? Array.from(new Set(matches)) : [];
}

/**
 * Check if content should be treated as a URL for auto-fetch
 */
export function shouldAutoFetch(content: string, contentType?: string): boolean {
  const trimmed = content.trim();

  // Explicit URL content type
  if (contentType === 'url') {
    return isValidUrl(trimmed);
  }

  // Auto-detect: if content is just a URL (with minimal surrounding text)
  if (isValidUrl(trimmed)) {
    return true;
  }

  // If content is short and starts with http/https, likely a URL
  if (trimmed.length < 2000 && /^https?:\/\//i.test(trimmed)) {
    const urls = detectUrls(trimmed);
    // If the URL makes up most of the content, treat as URL
    if (urls.length === 1 && urls[0].length > trimmed.length * 0.8) {
      return true;
    }
  }

  return false;
}

/**
 * Extract YouTube video ID from URL
 */
export function extractYoutubeVideoId(url: string): string | null {
  for (const pattern of YOUTUBE_PATTERNS) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Check if URL is a YouTube video
 */
export function isYoutubeUrl(url: string): boolean {
  return extractYoutubeVideoId(url) !== null;
}

// =============================================================================
// HTML TO TEXT EXTRACTION
// =============================================================================

/**
 * Simple HTML to text extraction
 * Strips tags, scripts, styles, and extracts readable content
 */
export function htmlToText(html: string): string {
  let text = html;

  // Remove script and style content entirely
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');

  // Remove common navigation/footer elements
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '');

  // Remove common ad/tracking elements by class/id patterns
  text = text.replace(/<[^>]*(class|id)=["'][^"']*(ad|ads|advert|banner|sidebar|cookie|popup|modal|newsletter|social|share|comment|related|recommended)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '');

  // Convert block elements to newlines
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|article|section)[^>]*>/gi, '\n');

  // Add space before inline elements
  text = text.replace(/<\/?(a|span|strong|em|b|i|u)[^>]*>/gi, ' ');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Clean up whitespace
  text = text.replace(/[\t ]+/g, ' ');       // Multiple spaces/tabs to single space
  text = text.replace(/\n[ \t]+/g, '\n');    // Leading whitespace on lines
  text = text.replace(/[ \t]+\n/g, '\n');    // Trailing whitespace on lines
  text = text.replace(/\n{3,}/g, '\n\n');    // Multiple newlines to double newline
  text = text.trim();

  return text;
}

/**
 * Decode common HTML entities
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
    '&ndash;': '-',
    '&mdash;': '--',
    '&lsquo;': "'",
    '&rsquo;': "'",
    '&ldquo;': '"',
    '&rdquo;': '"',
    '&bull;': '- ',
    '&hellip;': '...',
    '&copy;': '(c)',
    '&reg;': '(R)',
    '&trade;': '(TM)',
  };

  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, 'gi'), char);
  }

  // Decode numeric entities
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  result = result.replace(/&#x([a-fA-F0-9]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));

  return result;
}

/**
 * Extract metadata from HTML
 */
export function extractHtmlMetadata(html: string): {
  title?: string;
  description?: string;
  ogImage?: string;
  author?: string;
  publishedDate?: string;
} {
  const metadata: ReturnType<typeof extractHtmlMetadata> = {};

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    metadata.title = decodeHtmlEntities(titleMatch[1].trim());
  }

  // Extract meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
  if (descMatch) {
    metadata.description = decodeHtmlEntities(descMatch[1].trim());
  }

  // Extract Open Graph image
  const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  if (ogImageMatch) {
    metadata.ogImage = ogImageMatch[1].trim();
  }

  // Extract Open Graph title (fallback)
  if (!metadata.title) {
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (ogTitleMatch) {
      metadata.title = decodeHtmlEntities(ogTitleMatch[1].trim());
    }
  }

  // Extract Open Graph description (fallback)
  if (!metadata.description) {
    const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    if (ogDescMatch) {
      metadata.description = decodeHtmlEntities(ogDescMatch[1].trim());
    }
  }

  // Extract author
  const authorMatch = html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i);
  if (authorMatch) {
    metadata.author = decodeHtmlEntities(authorMatch[1].trim());
  }

  // Extract published date
  const dateMatch = html.match(/<meta[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
  if (dateMatch) {
    metadata.publishedDate = dateMatch[1].trim();
  }

  return metadata;
}

/**
 * Extract article content from HTML (more intelligent extraction)
 * Attempts to find the main content area
 */
export function extractArticleContent(html: string): string {
  let content = html;

  // Try to find article/main content
  const articleMatch = content.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    content = articleMatch[1];
  } else {
    // Try to find main element
    const mainMatch = content.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) {
      content = mainMatch[1];
    } else {
      // Try common content containers
      const contentMatch = content.match(/<div[^>]*(?:class|id)=["'][^"']*(?:content|article|post|entry|story)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
      if (contentMatch) {
        content = contentMatch[1];
      }
    }
  }

  return htmlToText(content);
}

// =============================================================================
// URL CONTENT FETCHING
// =============================================================================

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; AetheneBot/1.0; +https://aethene.com)';
const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB

// =============================================================================
// SSRF PROTECTION - Block internal/private network access
// =============================================================================

const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  '169.254.169.254', // AWS/GCP metadata
  'metadata.google.internal',
];

const BLOCKED_HOST_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,        // 10.x.x.x (private)
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/, // 172.16-31.x.x (private)
  /^192\.168\.\d{1,3}\.\d{1,3}$/,            // 192.168.x.x (private)
  /^fc00:/i,                                   // IPv6 private
  /^fe80:/i,                                   // IPv6 link-local
];

/**
 * Check if a hostname is blocked (SSRF protection)
 */
function isBlockedHost(hostname: string): boolean {
  const lowerHost = hostname.toLowerCase();

  if (BLOCKED_HOSTS.includes(lowerHost)) {
    return true;
  }

  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(hostname)) {
      return true;
    }
  }

  return false;
}

/**
 * Fetch content from a URL
 */
export async function fetchUrl(
  url: string,
  options: UrlFetchOptions = {}
): Promise<UrlFetchResult> {
  const {
    timeout = DEFAULT_TIMEOUT,
    maxSize = DEFAULT_MAX_SIZE,
    userAgent = DEFAULT_USER_AGENT,
    extractMetadata = true,
  } = options;

  const originalUrl = url;
  const startTime = Date.now();

  // Validate URL
  if (!isValidUrl(url)) {
    return {
      success: false,
      content: '',
      contentType: 'unknown',
      url,
      originalUrl,
      metadata: { fetchedAt: startTime },
      error: 'Invalid URL format',
    };
  }

  // SSRF protection - block internal/private networks
  try {
    const parsedUrl = new URL(url);
    if (isBlockedHost(parsedUrl.hostname)) {
      return {
        success: false,
        content: '',
        contentType: 'unknown',
        url,
        originalUrl,
        metadata: { fetchedAt: startTime },
        error: 'Access to internal networks is not allowed',
      };
    }
  } catch {
    return {
      success: false,
      content: '',
      contentType: 'unknown',
      url,
      originalUrl,
      metadata: { fetchedAt: startTime },
      error: 'Invalid URL',
    };
  }

  // Check for YouTube
  const youtubeVideoId = extractYoutubeVideoId(url);
  if (youtubeVideoId) {
    return fetchYoutubeContent(url, youtubeVideoId, options);
  }

  try {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        content: '',
        contentType: 'unknown',
        url: response.url || url,
        originalUrl,
        metadata: {
          fetchedAt: startTime,
          statusCode: response.status,
        },
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    // Check content length
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    if (contentLength > maxSize) {
      return {
        success: false,
        content: '',
        contentType: 'unknown',
        url: response.url || url,
        originalUrl,
        metadata: {
          fetchedAt: startTime,
          contentLength,
          statusCode: response.status,
        },
        error: `Content too large: ${contentLength} bytes (max: ${maxSize})`,
      };
    }

    // Get content type
    const responseType = response.headers.get('content-type') || '';

    // Handle different content types
    if (responseType.includes('application/pdf')) {
      // PDF files - store URL for later processing
      return {
        success: true,
        content: `[PDF Document: ${url}]`,
        title: extractTitleFromUrl(url),
        contentType: 'pdf',
        url: response.url || url,
        originalUrl,
        metadata: {
          fetchedAt: startTime,
          contentLength,
          statusCode: response.status,
          responseType,
        },
      };
    }

    if (responseType.includes('image/')) {
      return {
        success: true,
        content: `[Image: ${url}]`,
        contentType: 'image',
        url: response.url || url,
        originalUrl,
        metadata: {
          fetchedAt: startTime,
          contentLength,
          statusCode: response.status,
          responseType,
        },
      };
    }

    if (responseType.includes('video/') || responseType.includes('audio/')) {
      const type = responseType.includes('video/') ? 'video' : 'audio';
      return {
        success: true,
        content: `[${type === 'video' ? 'Video' : 'Audio'}: ${url}]`,
        contentType: type,
        url: response.url || url,
        originalUrl,
        metadata: {
          fetchedAt: startTime,
          contentLength,
          statusCode: response.status,
          responseType,
        },
      };
    }

    // Read text content (HTML or plain text)
    const html = await response.text();

    // Check actual size
    if (html.length > maxSize) {
      return {
        success: false,
        content: '',
        contentType: 'unknown',
        url: response.url || url,
        originalUrl,
        metadata: {
          fetchedAt: startTime,
          contentLength: html.length,
          statusCode: response.status,
        },
        error: `Content too large: ${html.length} bytes (max: ${maxSize})`,
      };
    }

    // Extract metadata
    const htmlMetadata = extractMetadata ? extractHtmlMetadata(html) : {};

    // Extract text content
    const textContent = extractArticleContent(html);

    return {
      success: true,
      content: textContent,
      title: htmlMetadata.title,
      description: htmlMetadata.description,
      contentType: 'webpage',
      url: response.url || url,
      originalUrl,
      metadata: {
        fetchedAt: startTime,
        contentLength: html.length,
        statusCode: response.status,
        responseType,
        pageTitle: htmlMetadata.title,
        pageDescription: htmlMetadata.description,
        ogImage: htmlMetadata.ogImage,
      },
    };
  } catch (error: any) {
    let errorMessage = error.message || 'Unknown fetch error';

    if (error.name === 'AbortError') {
      errorMessage = `Request timeout after ${timeout}ms`;
    } else if (error.cause?.code === 'ENOTFOUND') {
      errorMessage = 'Domain not found';
    } else if (error.cause?.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused';
    }

    return {
      success: false,
      content: '',
      contentType: 'unknown',
      url,
      originalUrl,
      metadata: { fetchedAt: startTime },
      error: errorMessage,
    };
  }
}

/**
 * Extract title from URL path
 */
function extractTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;

    // Get the last segment
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      let title = segments[segments.length - 1];
      // Remove extension
      title = title.replace(/\.[^.]+$/, '');
      // Convert dashes/underscores to spaces and capitalize
      title = title.replace(/[-_]/g, ' ');
      title = title.replace(/\b\w/g, c => c.toUpperCase());
      return title;
    }

    return parsed.hostname;
  } catch {
    return url;
  }
}

// =============================================================================
// YOUTUBE CONTENT FETCHING
// =============================================================================

/**
 * Fetch YouTube video content (metadata and transcript if available)
 */
async function fetchYoutubeContent(
  url: string,
  videoId: string,
  options: UrlFetchOptions = {}
): Promise<UrlFetchResult> {
  const startTime = Date.now();
  const { timeout = DEFAULT_TIMEOUT } = options;

  try {
    // Fetch video page for metadata
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        content: '',
        contentType: 'youtube',
        url,
        originalUrl: url,
        metadata: {
          fetchedAt: startTime,
          statusCode: response.status,
          youtubeVideoId: videoId,
        },
        error: `Failed to fetch YouTube page: HTTP ${response.status}`,
      };
    }

    const html = await response.text();

    // Extract video title
    let title: string | undefined;
    const titleMatch = html.match(/<meta name="title" content="([^"]+)"/i)
      || html.match(/"title":\s*"([^"]+)"/);
    if (titleMatch) {
      title = decodeHtmlEntities(titleMatch[1]);
    }

    // Extract video description
    let description: string | undefined;
    const descMatch = html.match(/<meta name="description" content="([^"]+)"/i)
      || html.match(/"shortDescription":\s*"([^"]+)"/);
    if (descMatch) {
      description = decodeHtmlEntities(descMatch[1]);
    }

    // Extract channel name
    let channelName: string | undefined;
    const channelMatch = html.match(/"ownerChannelName":\s*"([^"]+)"/);
    if (channelMatch) {
      channelName = decodeHtmlEntities(channelMatch[1]);
    }

    // Try to get transcript (captions)
    const transcript = await fetchYoutubeTranscript(videoId, html);

    // Build content
    let content = '';
    if (title) {
      content += `Title: ${title}\n\n`;
    }
    if (channelName) {
      content += `Channel: ${channelName}\n\n`;
    }
    if (description) {
      content += `Description: ${description}\n\n`;
    }
    if (transcript) {
      content += `Transcript:\n${transcript}\n`;
    } else {
      content += `[Video URL: https://www.youtube.com/watch?v=${videoId}]\n`;
      content += '(Transcript not available)\n';
    }

    return {
      success: true,
      content: content.trim(),
      title,
      description,
      contentType: 'youtube',
      url: `https://www.youtube.com/watch?v=${videoId}`,
      originalUrl: url,
      metadata: {
        fetchedAt: startTime,
        statusCode: response.status,
        youtubeVideoId: videoId,
        pageTitle: title,
        pageDescription: description,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      content: '',
      contentType: 'youtube',
      url,
      originalUrl: url,
      metadata: {
        fetchedAt: startTime,
        youtubeVideoId: videoId,
      },
      error: error.message || 'Failed to fetch YouTube content',
    };
  }
}

/**
 * Attempt to fetch YouTube transcript/captions
 */
async function fetchYoutubeTranscript(videoId: string, pageHtml: string): Promise<string | null> {
  try {
    // Try to extract caption track URL from the page
    const captionMatch = pageHtml.match(/"captionTracks":\s*\[([^\]]+)\]/);
    if (!captionMatch) {
      return null;
    }

    // Parse caption tracks
    const captionData = captionMatch[1];
    const baseUrlMatch = captionData.match(/"baseUrl":\s*"([^"]+)"/);
    if (!baseUrlMatch) {
      return null;
    }

    // Clean up the URL (it may have escaped characters)
    let captionUrl = baseUrlMatch[1].replace(/\\u0026/g, '&');

    // Fetch the caption track
    const response = await fetch(captionUrl, {
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });

    if (!response.ok) {
      return null;
    }

    const captionXml = await response.text();

    // Parse caption XML to extract text
    const textSegments: string[] = [];
    const textPattern = /<text[^>]*>([^<]*)<\/text>/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textPattern.exec(captionXml)) !== null) {
      const text = decodeHtmlEntities(textMatch[1].trim());
      if (text) {
        textSegments.push(text);
      }
    }

    if (textSegments.length === 0) {
      return null;
    }

    // Join segments into paragraphs
    return textSegments.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return null;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export const UrlFetchService = {
  // Detection
  isValidUrl,
  detectUrls,
  shouldAutoFetch,
  isYoutubeUrl,
  extractYoutubeVideoId,

  // Fetching
  fetchUrl,

  // Extraction
  htmlToText,
  extractHtmlMetadata,
  extractArticleContent,
};

/**
 * Tests for URL Fetch Service
 */

import { describe, it, expect } from 'vitest';
import {
  isValidUrl,
  detectUrls,
  shouldAutoFetch,
  isYoutubeUrl,
  extractYoutubeVideoId,
  htmlToText,
  extractHtmlMetadata,
  extractArticleContent,
} from './url-fetch-service.js';

describe('URL Detection', () => {
  describe('isValidUrl', () => {
    it('should return true for valid HTTP URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('https://example.com/path/to/page')).toBe(true);
      expect(isValidUrl('https://example.com/path?query=value')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      expect(isValidUrl('not a url')).toBe(false);
      expect(isValidUrl('ftp://example.com')).toBe(false);
      expect(isValidUrl('example.com')).toBe(false);
      expect(isValidUrl('')).toBe(false);
    });
  });

  describe('detectUrls', () => {
    it('should detect a single URL', () => {
      expect(detectUrls('https://example.com')).toEqual(['https://example.com']);
    });

    it('should detect multiple URLs in text', () => {
      const text = 'Check out https://example.com and https://test.org for more info';
      const urls = detectUrls(text);
      expect(urls).toContain('https://example.com');
      expect(urls).toContain('https://test.org');
    });

    it('should return unique URLs only', () => {
      const text = 'Visit https://example.com twice: https://example.com';
      const urls = detectUrls(text);
      expect(urls).toHaveLength(1);
    });

    it('should return empty array for text without URLs', () => {
      expect(detectUrls('No URLs here')).toEqual([]);
    });
  });

  describe('shouldAutoFetch', () => {
    it('should return true for URL content type', () => {
      expect(shouldAutoFetch('https://example.com', 'url')).toBe(true);
    });

    it('should return true when content is a URL', () => {
      expect(shouldAutoFetch('https://example.com')).toBe(true);
      expect(shouldAutoFetch('  https://example.com  ')).toBe(true);
    });

    it('should return false for regular text', () => {
      expect(shouldAutoFetch('Just some text')).toBe(false);
      expect(shouldAutoFetch('Some text with a URL https://example.com but mostly text')).toBe(false);
    });
  });
});

describe('YouTube URL Detection', () => {
  describe('isYoutubeUrl', () => {
    it('should detect standard YouTube URLs', () => {
      expect(isYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
      expect(isYoutubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    });

    it('should detect short YouTube URLs', () => {
      expect(isYoutubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    });

    it('should detect embed URLs', () => {
      expect(isYoutubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(true);
    });

    it('should detect shorts URLs', () => {
      expect(isYoutubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(true);
    });

    it('should return false for non-YouTube URLs', () => {
      expect(isYoutubeUrl('https://example.com')).toBe(false);
      expect(isYoutubeUrl('https://vimeo.com/123456')).toBe(false);
    });
  });

  describe('extractYoutubeVideoId', () => {
    it('should extract video ID from standard URL', () => {
      expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from short URL', () => {
      expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from embed URL', () => {
      expect(extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    });

    it('should return null for non-YouTube URLs', () => {
      expect(extractYoutubeVideoId('https://example.com')).toBeNull();
    });
  });
});

describe('HTML Processing', () => {
  describe('htmlToText', () => {
    it('should strip HTML tags', () => {
      expect(htmlToText('<p>Hello</p>')).toBe('Hello');
      expect(htmlToText('<div><span>World</span></div>')).toBe('World');
    });

    it('should remove script and style content', () => {
      const html = '<script>alert("hi")</script><p>Content</p><style>.x{}</style>';
      expect(htmlToText(html)).toBe('Content');
    });

    it('should convert block elements to newlines', () => {
      const html = '<p>Para 1</p><p>Para 2</p>';
      const text = htmlToText(html);
      expect(text).toContain('Para 1');
      expect(text).toContain('Para 2');
    });

    it('should decode HTML entities', () => {
      expect(htmlToText('&amp; &lt; &gt;')).toBe('& < >');
      expect(htmlToText('hello&nbsp;world')).toContain('hello');
      expect(htmlToText('hello&nbsp;world')).toContain('world');
    });
  });

  describe('extractHtmlMetadata', () => {
    it('should extract title', () => {
      const html = '<html><head><title>Page Title</title></head></html>';
      expect(extractHtmlMetadata(html).title).toBe('Page Title');
    });

    it('should extract meta description', () => {
      const html = '<meta name="description" content="Page description here">';
      expect(extractHtmlMetadata(html).description).toBe('Page description here');
    });

    it('should extract Open Graph image', () => {
      const html = '<meta property="og:image" content="https://example.com/image.jpg">';
      expect(extractHtmlMetadata(html).ogImage).toBe('https://example.com/image.jpg');
    });
  });

  describe('extractArticleContent', () => {
    it('should extract content from article tag', () => {
      const html = '<nav>Nav</nav><article><p>Article content</p></article><footer>Footer</footer>';
      const content = extractArticleContent(html);
      expect(content).toContain('Article content');
      expect(content).not.toContain('Nav');
      expect(content).not.toContain('Footer');
    });

    it('should extract content from main tag', () => {
      const html = '<header>Header</header><main><p>Main content</p></main><aside>Sidebar</aside>';
      const content = extractArticleContent(html);
      expect(content).toContain('Main content');
    });

    it('should fall back to full content if no article/main', () => {
      const html = '<body><p>Body content</p></body>';
      const content = extractArticleContent(html);
      expect(content).toContain('Body content');
    });
  });
});

import { BadRequestException } from '@nestjs/common';
import * as sanitizeHtml from 'sanitize-html';

export const RESOURCE_PATH =
  /(?:src|href)="\/resource\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})"/gi;
const LOCAL_RESOURCE_URL =
  /^\/resource\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || LOCAL_RESOURCE_URL.test(url);
}

export function sanitizeLetterHtml(input: string): string {
  if (/\/resource\/[0-9a-f-]{36}\/file(?:\?|["'])/i.test(input)) {
    throw new BadRequestException('signed resource URLs cannot be saved in letters');
  }
  const clean = sanitizeHtml(input, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'em',
      's',
      'u',
      'h2',
      'h3',
      'ul',
      'ol',
      'li',
      'blockquote',
      'code',
      'pre',
      'a',
      'img',
      'hr',
    ],
    allowedAttributes: { a: ['href', 'target', 'rel'], img: ['src', 'alt', 'title'] },
    allowedSchemes: ['http', 'https'],
    transformTags: {
      a: (_tag, attributes) => ({
        tagName: 'a',
        attribs: safeUrl(attributes.href || '')
          ? { href: attributes.href, target: '_blank', rel: 'noopener noreferrer' }
          : {},
      }),
      img: (_tag, attributes) => ({
        tagName: 'img',
        attribs: safeUrl(attributes.src || '')
          ? { src: attributes.src, alt: attributes.alt || '' }
          : {},
      }),
    },
  }).trim();
  const text = sanitizeHtml(clean, { allowedTags: [], allowedAttributes: {} }).trim();
  if (!text && !/<img\b/i.test(clean)) {
    throw new BadRequestException('letter content is required');
  }
  return clean;
}

export function letterExcerpt(content: string, format: string): string {
  const text =
    format === 'html' ? sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} }) : content;
  return text.replace(/\s+/g, ' ').trim().slice(0, 255);
}

export function resourceUuids(content: string): string[] {
  return [...new Set([...content.matchAll(RESOURCE_PATH)].map((match) => match[1].toLowerCase()))];
}

export function plainLetterText(content: string, format: string): string {
  return format === 'html'
    ? sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} })
    : content;
}

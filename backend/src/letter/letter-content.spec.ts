import { BadRequestException } from '@nestjs/common';
import { letterExcerpt, resourceUuids, sanitizeLetterHtml } from './letter-content';

describe('letter rich content', () => {
  it('removes scripts, event handlers and unsafe URLs while preserving useful formatting', () => {
    const html = sanitizeLetterHtml(
      '<h2>Hello</h2><script>alert(1)</script><p><strong>friend</strong>' +
        '<img src="javascript:alert(1)" onerror="alert(2)"></p>' +
        '<a href="https://example.com/file.pdf" onclick="alert(3)">file</a>',
    );
    expect(html).toContain('<h2>Hello</h2>');
    expect(html).toContain('<strong>friend</strong>');
    expect(html).toContain('href="https://example.com/file.pdf"');
    expect(html).not.toMatch(/script|onerror|onclick|javascript:/i);
    expect(letterExcerpt(html, 'html')).toContain('Hello');
  });

  it('finds local resource references and rejects empty letters', () => {
    const uuid = '22222222-2222-4222-8222-222222222222';
    const clean = sanitizeLetterHtml(
      `<p><img src="/resource/${uuid}"></p><a href="/resource/${uuid}">x</a>`,
    );
    expect(resourceUuids(clean)).toEqual([uuid]);
    expect(() => sanitizeLetterHtml('<p><br></p>')).toThrow(BadRequestException);
  });

  it('keeps disallowed raw-text, SVG, and URI attributes out of saved HTML', () => {
    const html = sanitizeLetterHtml(
      '<p>safe</p><textarea></textarea/><img src=x onerror="alert(1)">' +
        '<svg><a><animate attributeName="href" values="#safe;javascript:alert(2)"></animate></a></svg>' +
        '<form action="javascript:alert(3)"><button formaction="javascript:alert(4)">go</button></form>',
    );
    expect(html).toContain('<p>safe</p>');
    expect(html).not.toMatch(/textarea|svg|animate|onerror|javascript:|action=/i);
  });
});

import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import type { SystemDocumentDetail, SystemDocumentSummary } from '@eks/contracts';

export interface DocumentHeading {
  id: string;
  text: string;
  level: number;
}
const slug = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-|-$/g, '') || 'section';
export function documentAnchor(value: string) {
  try {
    value = decodeURIComponent(value.replace(/^#/, ''));
  } catch {
    return '';
  }
  return value.startsWith('doc-') ? value : `doc-${slug(value)}`;
}

export function renderDocument(document: SystemDocumentDetail, catalog: SystemDocumentSummary[]) {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
  const escape = md.utils.escapeHtml;
  const tokens = md.parse(document.markdown, {});
  const firstHeading = tokens.findIndex((token) => token.type === 'heading_open');
  if (
    tokens[firstHeading]?.tag === 'h1' &&
    tokens[firstHeading + 1]?.content.trim() === document.title.trim()
  )
    tokens.splice(firstHeading, 3);
  const headings: DocumentHeading[] = [],
    used = new Map<string, number>();
  tokens.forEach((token, index) => {
    if (token.type !== 'heading_open') return;
    const inline = tokens[index + 1];
    const text =
      (inline?.children || [])
        .filter((child) => ['text', 'code_inline', 'image'].includes(child.type))
        .map((child) => child.content)
        .join('') ||
      inline?.content ||
      '';
    const base = `doc-${slug(text)}`,
      count = used.get(base) || 0;
    used.set(base, count + 1);
    const id = count ? `${base}-${count + 1}` : base;
    token.attrSet('id', id);
    token.attrSet('tabindex', '-1');
    if (token.tag === 'h1') {
      token.tag = 'h2';
      tokens[index + 2]!.tag = 'h2';
    }
    headings.push({ id, text, level: Number(token.tag.slice(1)) });
  });

  function destination(raw: string) {
    if (raw.startsWith('#')) return `#${documentAnchor(raw)}`;
    if (/^https?:\/\//i.test(raw)) {
      try {
        const url = new URL(raw);
        if (['http:', 'https:'].includes(url.protocol)) return url.href;
      } catch {
        /* Render malformed destinations as references. */
      }
      return '';
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith('//') || raw.includes('\\')) return '';
    try {
      const url = new URL(raw, `https://eks-documents.invalid/${document.sourcePath}`);
      if (url.origin !== 'https://eks-documents.invalid') return '';
      const target = catalog.find(
        (item) => item.sourcePath === decodeURIComponent(url.pathname.slice(1)),
      );
      return target ? `/system/documents/${target.id}${url.hash}` : '';
    } catch {
      return '';
    }
  }
  const linkOpen =
    md.renderer.rules.link_open ||
    ((ts, i, options, _env, renderer) => renderer.renderToken(ts, i, options));
  md.renderer.rules.link_open = (ts, i, options, env, renderer) => {
    const token = ts[i]!,
      raw = String(token.attrGet('href') || ''),
      href = destination(raw);
    if (!href) {
      token.meta = { documentReference: raw };
      return `<span class="document-reference">`;
    }
    token.attrSet('href', href);
    if (/^https?:/.test(href)) {
      token.attrSet('target', '_blank');
      token.attrSet('rel', 'noopener noreferrer');
    }
    return linkOpen(ts, i, options, env, renderer);
  };
  md.renderer.rules.link_close = (ts, i, options, _env, renderer) => {
    let depth = 0;
    for (let n = i - 1; n >= 0; n--) {
      if (ts[n]!.type === 'link_close') depth++;
      if (ts[n]!.type === 'link_open') {
        if (depth) {
          depth--;
          continue;
        }
        const reference = ts[n]!.meta?.documentReference;
        if (typeof reference === 'string')
          return `<span class="document-reference-path"> (${escape(reference)})</span></span>`;
        break;
      }
    }
    return renderer.renderToken(ts, i, options);
  };
  md.renderer.rules.image = (ts, i) => {
    const token = ts[i]!,
      raw = String(token.attrGet('src') || ''),
      alt = token.content;
    const src = /^https?:\/\//i.test(raw) ? destination(raw) : '';
    return src
      ? `<img src="${escape(src)}" alt="${escape(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
      : `<span class="document-reference">${escape(alt)}<span class="document-reference-path"> (${escape(raw)})</span></span>`;
  };
  md.renderer.rules.table_open = () =>
    '<div class="document-table-scroll" tabindex="0" role="region" aria-label="문서 표"><table>';
  md.renderer.rules.table_close = () => '</table></div>';
  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (...args) => fence(...args).replace('<pre>', '<pre tabindex="0">');
  md.renderer.rules.code_block = (ts, i) =>
    `<pre tabindex="0"><code>${escape(ts[i]!.content)}</code></pre>`;
  const html = DOMPurify.sanitize(md.renderer.render(tokens, md.options, {}), {
    ALLOWED_TAGS: [
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'a',
      'ul',
      'ol',
      'li',
      'strong',
      'em',
      's',
      'blockquote',
      'hr',
      'pre',
      'code',
      'br',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'img',
      'span',
      'div',
    ],
    ALLOWED_ATTR: [
      'id',
      'class',
      'href',
      'title',
      'target',
      'rel',
      'src',
      'alt',
      'loading',
      'decoding',
      'referrerpolicy',
      'tabindex',
      'role',
      'aria-label',
      'start',
    ],
    ALLOW_DATA_ATTR: false,
  });
  return { html, headings };
}

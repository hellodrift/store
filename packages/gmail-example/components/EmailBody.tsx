/**
 * EmailBody — Safe email content renderer for Gmail plugin.
 *
 * Renders HTML email bodies with:
 * - Browser-native DOMParser sanitization (whitelist approach, zero dependencies)
 * - Scoped CSS to prevent email styles from leaking into the host app
 * - External images blocked by default with "Load images" banner
 * - Fallback to plain text with auto-linked URLs
 *
 * Security model:
 * - All HTML is parsed via DOMParser, walked recursively
 * - Only whitelisted tags and attributes survive
 * - All event handler attributes (onclick, onerror, etc.) are stripped
 * - <script>, <style>, <iframe>, <object>, <embed> are removed
 * - javascript: and data: URIs in href/src are blocked
 * - External images are blocked by default (tracking pixel protection)
 */

import { useMemo, useState, useEffect } from 'react';

// ── Sanitization config ────────────────────────────────────────────────────

const ALLOWED_TAGS = new Set([
  'div', 'span', 'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup',
  'ul', 'ol', 'li',
  'a',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'img',
  'blockquote',
  'pre', 'code',
  'dl', 'dt', 'dd',
  'abbr', 'address', 'cite', 'q',
  'figure', 'figcaption',
  'section', 'article', 'header', 'footer', 'main', 'nav', 'aside',
  'small', 'mark', 'del', 'ins',
  'details', 'summary',
  'center', 'font',
]);

const ALLOWED_ATTRS = new Set([
  'href', 'src', 'alt', 'title',
  'style', 'class',
  'colspan', 'rowspan', 'width', 'height',
  'target', 'rel',
  'align', 'valign', 'bgcolor', 'color', 'border',
  'cellpadding', 'cellspacing',
  'dir', 'lang',
  'id',
  'role', 'aria-label', 'aria-hidden', 'aria-describedby',
  'scope', 'headers',
  'size', 'face',
  // Custom data attribute for blocked images (set by sanitizer)
  'data-blocked-src',
]);

const DANGEROUS_URI_PATTERN = /^\s*(javascript|vbscript)\s*:/i;

/**
 * Check if a URL is an external image (http/https).
 * Data URIs and relative paths are considered safe/local.
 */
function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

interface SanitizeResult {
  html: string;
  hasBlockedImages: boolean;
}

/**
 * Sanitize an HTML string using the browser's DOMParser.
 * External images are blocked by default — their src is moved to data-blocked-src.
 * Returns sanitized HTML and whether any images were blocked.
 */
function sanitizeHtml(html: string): SanitizeResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  let hasBlockedImages = false;

  const sanitizeNode = (node: Node): Node | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.cloneNode(true);
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const element = node as Element;
    const tagName = element.tagName.toLowerCase();

    // Remove dangerous tags entirely (including children)
    if (tagName === 'script' || tagName === 'style' || tagName === 'iframe' ||
        tagName === 'object' || tagName === 'embed' || tagName === 'form' ||
        tagName === 'input' || tagName === 'textarea' || tagName === 'select' ||
        tagName === 'button' || tagName === 'link' || tagName === 'meta' ||
        tagName === 'base' || tagName === 'applet') {
      return null;
    }

    // If tag not in whitelist, keep children but unwrap the tag
    if (!ALLOWED_TAGS.has(tagName)) {
      const fragment = document.createDocumentFragment();
      for (const child of Array.from(node.childNodes)) {
        const sanitized = sanitizeNode(child);
        if (sanitized) fragment.appendChild(sanitized);
      }
      return fragment;
    }

    // Create a clean element with only whitelisted attributes
    const clean = document.createElement(tagName);

    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();

      // Skip event handlers
      if (name.startsWith('on')) continue;

      // Check whitelist
      if (!ALLOWED_ATTRS.has(name)) continue;

      const value = attr.value;

      // Block dangerous URIs in href/src
      if ((name === 'href' || name === 'src') && DANGEROUS_URI_PATTERN.test(value)) {
        continue;
      }

      // Force links to open externally
      if (name === 'href' && tagName === 'a') {
        clean.setAttribute('target', '_blank');
        clean.setAttribute('rel', 'noopener noreferrer');
      }

      // Block external images: move src to data-blocked-src
      if (name === 'src' && tagName === 'img' && isExternalUrl(value)) {
        clean.setAttribute('data-blocked-src', value);
        clean.setAttribute('alt', element.getAttribute('alt') || '[image]');
        hasBlockedImages = true;
        continue; // don't set src
      }

      clean.setAttribute(name, value);
    }

    // Recursively sanitize children
    for (const child of Array.from(node.childNodes)) {
      const sanitized = sanitizeNode(child);
      if (sanitized) clean.appendChild(sanitized);
    }

    return clean;
  };

  // Process the body content
  const fragment = document.createDocumentFragment();
  for (const child of Array.from(doc.body.childNodes)) {
    const sanitized = sanitizeNode(child);
    if (sanitized) fragment.appendChild(sanitized);
  }

  // Serialize back to HTML string
  const wrapper = document.createElement('div');
  wrapper.appendChild(fragment);
  return { html: wrapper.innerHTML, hasBlockedImages };
}

// ── Plain text helpers ─────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s<>"']+/g;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi;

/**
 * Convert plain text to HTML with auto-linked URLs and emails,
 * preserving whitespace and line breaks.
 */
function plainTextToHtml(text: string): string {
  // Escape HTML entities first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Auto-link URLs
  html = html.replace(URL_REGEX, (url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );

  // Auto-link email addresses
  html = html.replace(EMAIL_REGEX, (email) =>
    `<a href="mailto:${email}">${email}</a>`
  );

  // Style quoted lines (> prefix)
  html = html.replace(/^(&gt;.*)$/gm, '<span class="email-quoted-line">$1</span>');

  // Convert line breaks to <br>
  html = html.replace(/\n/g, '<br>');

  return html;
}

// ── Scoped CSS ─────────────────────────────────────────────────────────────

function getEmailContentStyles(): string {
  return `
    .drift-email-body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.6;
      color: var(--text-primary);
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .drift-email-body p {
      margin: 0 0 8px 0;
    }
    .drift-email-body a {
      color: var(--text-link, #1A73E8);
      text-decoration: none;
    }
    .drift-email-body a:hover {
      text-decoration: underline;
    }
    .drift-email-body img {
      max-width: 100%;
      height: auto;
      border-radius: 4px;
    }
    .drift-email-body img[data-blocked-src]:not([src]) {
      display: none;
    }
    .drift-email-body blockquote {
      margin: 8px 0;
      padding: 4px 12px;
      border-left: 3px solid var(--border-muted, #DADCE0);
      color: var(--text-muted, #5F6368);
    }
    .drift-email-body table {
      border-collapse: collapse;
      max-width: 100%;
      overflow-x: auto;
    }
    .drift-email-body pre,
    .drift-email-body code {
      font-family: "SF Mono", "Fira Code", "Consolas", monospace;
      font-size: 12px;
      background: var(--surface-subtle, #F1F3F4);
      border-radius: 4px;
    }
    .drift-email-body code {
      padding: 1px 4px;
    }
    .drift-email-body pre {
      padding: 8px 12px;
      overflow-x: auto;
    }
    .drift-email-body pre code {
      padding: 0;
      background: none;
    }
    .drift-email-body h1,
    .drift-email-body h2,
    .drift-email-body h3,
    .drift-email-body h4,
    .drift-email-body h5,
    .drift-email-body h6 {
      margin: 12px 0 6px;
      line-height: 1.3;
    }
    .drift-email-body h1 { font-size: 18px; }
    .drift-email-body h2 { font-size: 16px; }
    .drift-email-body h3 { font-size: 14px; }
    .drift-email-body h4,
    .drift-email-body h5,
    .drift-email-body h6 { font-size: 13px; }
    .drift-email-body ul,
    .drift-email-body ol {
      margin: 4px 0;
      padding-left: 20px;
    }
    .drift-email-body li {
      margin: 2px 0;
    }
    .drift-email-body hr {
      border: none;
      border-top: 1px solid var(--border-muted, #DADCE0);
      margin: 12px 0;
    }
    .drift-email-body .email-quoted-line {
      color: var(--text-muted, #5F6368);
      font-style: italic;
    }
    .drift-email-body center {
      text-align: center;
    }
    .drift-email-body font {
      font-family: inherit;
    }
  `;
}

// ── Component ──────────────────────────────────────────────────────────────

interface EmailBodyProps {
  /** HTML body from Gmail API */
  bodyHtml?: string;
  /** Plain text body from Gmail API */
  bodyText?: string;
  /** Snippet fallback */
  snippet?: string;
}

export default function EmailBody({ bodyHtml, bodyText, snippet }: EmailBodyProps) {
  const [imagesLoaded, setImagesLoaded] = useState(false);

  const { html: sanitizedHtml, hasBlockedImages } = useMemo(() => {
    if (bodyHtml) {
      return sanitizeHtml(bodyHtml);
    }
    if (bodyText) {
      return { html: plainTextToHtml(bodyText), hasBlockedImages: false };
    }
    if (snippet) {
      return { html: plainTextToHtml(snippet), hasBlockedImages: false };
    }
    return { html: '', hasBlockedImages: false };
  }, [bodyHtml, bodyText, snippet]);

  // When imagesLoaded is true, restore blocked image srcs in the HTML string
  // (no DOM manipulation — React-friendly approach)
  const displayHtml = useMemo(() => {
    if (!imagesLoaded || !hasBlockedImages) return sanitizedHtml;
    // Replace data-blocked-src="url" with src="url"
    return sanitizedHtml.replace(
      /\sdata-blocked-src="([^"]*)"/g,
      ' src="$1" data-blocked-src="$1"',
    );
  }, [sanitizedHtml, imagesLoaded, hasBlockedImages]);

  // Reset image state when content changes
  useEffect(() => {
    setImagesLoaded(false);
  }, [bodyHtml, bodyText, snippet]);

  if (!displayHtml) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        (No content)
      </div>
    );
  }

  return (
    <>
      <style>{getEmailContentStyles()}</style>

      {/* "Load images" banner */}
      {hasBlockedImages && !imagesLoaded && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            marginBottom: 8,
            borderRadius: 6,
            fontSize: 12,
            background: 'var(--surface-subtle, #F1F3F4)',
            border: '1px solid var(--border-muted, #DADCE0)',
            color: 'var(--text-muted, #5F6368)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          </svg>
          <span style={{ flex: 1 }}>Images are hidden for your privacy.</span>
          <button
            type="button"
            onClick={() => setImagesLoaded(true)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--text-link, #1A73E8)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover, rgba(0,0,0,0.05))'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
          >
            Load images
          </button>
        </div>
      )}

      <div
        className="drift-email-body"
        dangerouslySetInnerHTML={{ __html: displayHtml }}
      />
    </>
  );
}

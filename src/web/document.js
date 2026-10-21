import MarkdownIt from 'markdown-it';

// Repository HTML stays literal text. No plugins or remote images are executed/loaded.
const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index];
  const label = markdown.utils.escapeHtml(token.content || 'Image');
  const href = markdown.utils.escapeHtml(token.attrGet('src') || '');
  return `<a href="${href}">${label} ↗</a>`;
};

/** Render instructions while preserving the complete original separately for copying. */
export function renderSkillDocument(container, source, sourceLink) {
  container.replaceChildren();
  let body = source;
  const lines = source.split(/\r?\n/);
  const end = lines[0]?.trim() === '---'
    ? lines.findIndex((line, index) => index > 0 && line.trim() === '---') : -1;
  if (end > 0) {
    const metadata = document.createElement('details');
    metadata.className = 'document-metadata';
    const summary = document.createElement('summary');
    summary.textContent = 'Skill metadata';
    const pre = document.createElement('pre');
    pre.textContent = lines.slice(1, end).join('\n');
    metadata.append(summary, pre);
    container.append(metadata);
    body = lines.slice(end + 1).join('\n');
  }
  const template = document.createElement('template');
  // markdown-it emits escaped text for all raw HTML, and validates Markdown URLs.
  template.innerHTML = markdown.render(body);
  const headings = new Map();
  for (const heading of template.content.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const slug = heading.textContent.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const count = headings.get(slug) || 0;
    headings.set(slug, count + 1);
    const anchor = count ? `${slug}-${count}` : slug;
    heading.id = `skill-document-${anchor}`;
  }
  for (const link of template.content.querySelectorAll('a')) {
    const href = link.getAttribute('href') || '';
    if (href.startsWith('#')) {
      const heading = [...template.content.querySelectorAll('[id]')]
        .find((element) => element.id.slice('skill-document-'.length) === href.slice(1));
      if (heading) { link.setAttribute('href', `#${heading.id}`); continue; }
    }
    try {
      const url = new URL(href, sourceLink);
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) throw new Error('Unsupported link');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } catch {
      link.removeAttribute('href');
    }
  }
  // Wrap wide tables rather than allowing them to widen the whole page.
  for (const table of template.content.querySelectorAll('table')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'document-table';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Document table');
    table.replaceWith(wrapper);
    wrapper.append(table);
  }
  container.append(template.content);
}

/** Support both secure browser pages and portable files with a legacy clipboard fallback. */
export async function copyMarkdown(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch { /* A denied Clipboard API can still allow a user-initiated legacy copy. */ }
  const previous = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.readOnly = true;
  textarea.setAttribute('aria-label', 'Skill Markdown to copy');
  Object.assign(textarea.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0' });
  document.body.append(textarea);
  try {
    textarea.select();
    if (!document.execCommand?.('copy')) throw new Error('Clipboard unavailable');
  } finally {
    textarea.remove();
    previous?.focus?.({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}

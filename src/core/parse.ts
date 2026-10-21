import { parseDocument } from 'yaml';

/** What a SKILL.md says about itself. */
export type ParsedSkill = {
  /** Missing when the front matter has no name. */
  name?: string;
  description: string;
  /** The other front matter keys. */
  properties: Record<string, unknown>;
  /** The Markdown after the front matter. */
  body: string;
  warning?: string;
};

/**
 * Reads the YAML front matter between the leading `---` lines and the body
 * after it. Malformed front matter is not fatal: the skill keeps its directory
 * name and gets a warning.
 */
export function parseSkill(text: string): ParsedSkill {
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== '---') return fallback('no front matter', text);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return fallback('front matter without a closing ---', text);
  const body = lines.slice(end + 1).join('\n');
  // The leading newline keeps YAML's line numbers equal to the file's.
  const document = parseDocument(`\n${lines.slice(1, end).join('\n')}`);
  const [error] = document.errors;
  if (error) return fallback(`malformed front matter: ${error.message.split('\n')[0].replace(/:$/, '')}`, body);
  let data: unknown;
  try {
    // Conversion can reject aliases even when YAML syntax itself is valid.
    // Keep the library's expansion limit and treat this like malformed metadata.
    data = document.toJS();
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : 'YAML conversion failed';
    return fallback(`malformed front matter: ${reason}`, body);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return fallback('front matter is not a mapping', body);
  }
  const { name, description, ...properties } = data as Record<string, unknown>;
  return { name: asText(name) || undefined, description: asText(description), properties, body: trim(body) };
}

function fallback(reason: string, body: string): ParsedSkill {
  return { description: '', properties: {}, body: trim(body), warning: `${reason}; using the directory name` };
}

function asText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

/** Without the blank lines around it; the first line keeps its indentation. */
function trim(body: string): string {
  return body.replace(/^(?:[ \t]*\n)+/, '').trimEnd();
}

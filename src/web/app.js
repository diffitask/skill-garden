const form = document.querySelector('#repository-form');
const input = document.querySelector('#repository');
const button = document.querySelector('#scan');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const empty = document.querySelector('#empty');
const warnings = document.querySelector('#warnings');
const list = document.querySelector('#skills');
const errorPanel = document.querySelector('#scan-error');
const tokenInput = document.querySelector('#github-token');
const addToken = document.querySelector('#add-token');

document.querySelector('#retry').addEventListener('click', () => form.requestSubmit());
addToken.addEventListener('click', () => {
  tokenInput.focus();
});

function selectSkill(skill, item) {
  for (const sibling of list.children) sibling.removeAttribute('aria-current');
  item.setAttribute('aria-current', 'true');
  document.querySelector('#skill-name').textContent = skill.name;
  renderDescription(skill.description);
  document.querySelector('#full-document').open = false;
  document.querySelector('#path').textContent = skill.path;
  document.querySelector('#content').textContent = skill.content;
  document.querySelector('#source').href = skill.link;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  input.disabled = true;
  form.setAttribute('aria-busy', 'true');
  status.textContent = 'Scanning the repository and reading its skills…';
  errorPanel.hidden = true;
  tokenInput.disabled = true;
  results.hidden = true;
  empty.hidden = true;
  warnings.hidden = true;
  list.replaceChildren();
  try {
    const data = await loadRepository(input.value.trim());
    document.querySelector('#repo-name').textContent = data.repository.id;
    document.querySelector('#count').textContent = `${data.skills.length} ${data.skills.length === 1 ? 'skill' : 'skills'}`;
    warnings.textContent = data.warnings.join('\n');
    warnings.hidden = data.warnings.length === 0;
    status.textContent = `Scanned ${data.repository.id} at commit ${data.repository.commit.slice(0, 7)}.`;
    if (!data.skills.length) {
      empty.hidden = false;
      document.querySelector('#empty-title').textContent = 'No skills found.';
      document.querySelector('#empty-message').textContent = 'This repository has no SKILL.md files. Try another repository.';
      return;
    }
    for (const skill of data.skills) {
      const item = document.createElement('button');
      item.type = 'button';
      const name = document.createElement('strong');
      name.textContent = skill.name;
      const description = document.createElement('span');
      description.textContent = skill.description || skill.path;
      item.append(name, description);
      item.addEventListener('click', () => selectSkill(skill, item));
      list.append(item);
    }
    results.hidden = false;
    selectSkill(data.skills[0], list.firstElementChild);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to scan the repository.';
    const limited = /rate limit/i.test(message);
    const portable = typeof globalThis.skillAtlasScan === 'function';
    document.querySelector('#error-title').textContent = limited ? 'GitHub request limit reached' : 'Repository scan failed';
    document.querySelector('#error-message').textContent = limited
      ? (portable
        ? (tokenInput.value.trim()
          ? 'GitHub has temporarily limited requests for this token. Wait for the limit to reset, then try again.'
          : 'GitHub has temporarily limited requests from your connection. Wait for the limit to reset, or add a GitHub token and try again.')
        : 'GitHub has temporarily limited requests. Wait for the limit to reset, or restart the server with GITHUB_TOKEN set.')
      : (portable && /rejected the token/i.test(message)
        ? 'GitHub rejected this token. Replace or remove it in the GitHub token field, then try again.'
        : message);
    addToken.hidden = !portable || !limited || Boolean(tokenInput.value.trim());
    status.textContent = 'Scan failed. See the error below.';
    errorPanel.hidden = false;
    errorPanel.focus();
  } finally {
    button.disabled = false;
    input.disabled = false;
    tokenInput.disabled = false;
    form.removeAttribute('aria-busy');
  }
});

async function loadRepository(repository) {
  // The portable HTML supplies a direct GitHub scanner; the server view uses its API.
  if (globalThis.skillAtlasScan) return globalThis.skillAtlasScan(repository, tokenInput.value.trim());
  const response = await fetch(`/api/scan?repository=${encodeURIComponent(repository)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to scan the repository.');
  return data;
}

/** Arrange the original description into sections without generating new claims. */
function renderDescription(description) {
  const container = document.querySelector('#description');
  container.replaceChildren();
  if (!description.trim()) {
    const fallback = document.createElement('p');
    fallback.className = 'description-missing';
    fallback.textContent = 'No description provided. Open the full SKILL.md for instructions.';
    container.append(fallback);
    return;
  }
  // Sentence boundaries retain version numbers such as 0.61.0 and 1.0.
  const sentences = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(description)].map((part) => part.segment.trim())
    : description.split(/(?<=[.!?])\s+(?=[A-Z])/);
  const groups = { overview: [], details: [], usage: [], cautions: [] };
  for (const sentence of sentences) {
    // Only explicit qualifiers create a caution section; keep every word.
    const parts = sentence.split(/(?<=;)\s+(?=(?:for older|for newer|requires?\b|warning\b|caution\b|not for\b))/i);
    for (const part of parts) {
      if (/^(?:use (?:when|for|to)|when to use|useful (?:when|for)|activate when|trigger when)\b/i.test(part)) groups.usage.push(part);
      else if (/^(?:for older|for newer|requires?\b|warning\b|caution\b|note:|not for\b|only\b|limitations?:)/i.test(part)) groups.cautions.push(part);
      else if (!groups.overview.length) groups.overview.push(part);
      else groups.details.push(part);
    }
  }
  const sections = [
    ['overview', 'What it does'], ['details', 'Details'],
    ['usage', 'When to use'], ['cautions', 'Compatibility & cautions'],
  ];
  for (const [key, title] of sections) {
    if (!groups[key].length) continue;
    const section = document.createElement('section');
    section.className = `summary-block summary-${key}`;
    const heading = document.createElement('h3');
    heading.textContent = title;
    section.append(heading);
    if (groups[key].length === 1) {
      const paragraph = document.createElement('p');
      paragraph.textContent = groups[key][0];
      section.append(paragraph);
    } else {
      const list = document.createElement('ul');
      for (const text of groups[key]) {
        const item = document.createElement('li');
        item.textContent = text;
        list.append(item);
      }
      section.append(list);
    }
    container.append(section);
  }
}

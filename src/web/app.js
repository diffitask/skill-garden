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
  for (const sibling of list.querySelectorAll('button')) sibling.removeAttribute('aria-current');
  item.setAttribute('aria-current', 'true');
  document.querySelector('#skill-name').textContent = skill.name;
  document.querySelector('#skill-repository').textContent = skill.repository;
  renderDescription(skill.description);
  document.querySelector('#full-document').open = false;
  document.querySelector('#path').textContent = skill.path;
  document.querySelector('#content').textContent = skill.content;
  document.querySelector('#source').href = skill.link;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (form.hasAttribute('aria-busy')) return;
  button.disabled = true;
  input.disabled = true;
  form.setAttribute('aria-busy', 'true');
  status.textContent = 'Scanning repositories and reading their skills…';
  errorPanel.hidden = true;
  tokenInput.disabled = true;
  results.hidden = true;
  empty.hidden = true;
  warnings.hidden = true;
  warnings.textContent = '';
  for (const selector of ['#repo-name', '#count', '#skill-name', '#skill-repository', '#description', '#path', '#content']) {
    document.querySelector(selector).replaceChildren();
  }
  document.querySelector('#source').removeAttribute('href');
  list.replaceChildren();
  document.querySelector('#scan-summary').textContent = '';
  document.querySelector('#test-data').replaceChildren();
  try {
    const data = await loadRepository(input.value.trim());
    const organization = data.organization;
    const name = organization ? organization.name : data.repository.id;
    document.querySelector('#repo-name').textContent = name;
    document.querySelector('#count').textContent = `${data.skills.length} ${data.skills.length === 1 ? 'skill' : 'skills'}`;
    warnings.textContent = data.warnings.map(formatFailure).join('\n');
    warnings.hidden = data.warnings.length === 0;
    if (organization) {
      const c = data.counts;
      document.querySelector('#scan-summary').textContent = `${name} · ${data.skills.length} skills · Repositories: ${c.discovered} discovered, ${c.scanned} successfully scanned, ${c.failed} failed, ${c.skipped} skipped`;
      status.textContent = data.partial ? `Partial results for ${name}. See repository warnings below.` : `Scanned organization ${name}.`;
    } else status.textContent = `Scanned ${name} at commit ${data.repository.commit.slice(0, 7)}.`;
    const repositories = organization ? data.repositories : [data];
    const tests = document.querySelector('#test-data');
    for (const repo of repositories) {
      if (organization) {
        const heading = document.createElement('h3');
        heading.textContent = `${repo.repository.id} · ${repo.skills.length} skills`;
        list.append(heading);
      }
      const groups = organization ? [
        ["In agents' folders", repo.skills.filter((skill) => skill.inAgentFolder)],
        ['Elsewhere', repo.skills.filter((skill) => !skill.inAgentFolder)],
      ] : [['', repo.skills]];
      for (const [group, skills] of groups) {
        if (group && skills.length) {
          const heading = document.createElement('h4');
          heading.textContent = `${group} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`;
          list.append(heading);
        }
        for (const skill of skills) {
          const item = document.createElement('button');
          item.type = 'button';
          const title = document.createElement('strong');
          title.textContent = skill.name;
          const description = document.createElement('span');
          description.textContent = skill.description || skill.path;
          item.append(title, description);
          if (organization) {
            const source = document.createElement('span');
            source.textContent = skill.repository;
            item.append(source);
          }
          if (skill.copies.length) {
            const copies = document.createElement('span');
            copies.textContent = `also in ${skill.copies.join(', ')}`;
            item.append(copies);
          }
          item.addEventListener('click', () => selectSkill(skill, item));
          list.append(item);
        }
      }
      if (repo.testDataLinks?.length) {
        const heading = document.createElement('h3');
        heading.textContent = `${repo.repository.id} · Test data, not skills · ${repo.testDataLinks.length} files`;
        tests.append(heading);
        for (const file of repo.testDataLinks) {
          const paragraph = document.createElement('p');
          const link = document.createElement('a');
          link.href = file.link;
          link.textContent = file.path;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          paragraph.append(link);
          tests.append(paragraph);
        }
      }
    }
    if (!data.skills.length) {
      empty.hidden = false;
      document.querySelector('#empty-title').textContent = data.partial ? 'No skills available from completed scans.' : 'No skills found.';
      document.querySelector('#empty-message').textContent = organization
        ? (data.partial ? 'Some repositories could not be fully scanned. Review the warnings and try again.'
          : data.counts.discovered ? 'This organization has no skills in its public repositories.' : 'This organization has no public repositories.')
        : 'This repository has no SKILL.md files. Try another repository.';
      return;
    }
    results.hidden = false;
    const first = list.querySelector('button');
    first.click();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to scan the repository.';
    const limited = /rate limit/i.test(message);
    const portable = typeof globalThis.skillAtlasScan === 'function';
    document.querySelector('#error-title').textContent = limited ? 'GitHub request limit reached' : 'Repository or organization scan failed';
    document.querySelector('#error-message').textContent = formatFailure(message);
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

function formatFailure(message) {
  const portable = typeof globalThis.skillAtlasScan === 'function';
  const guidance = portable
    ? (tokenInput.value.trim()
      ? 'GitHub has temporarily limited requests for this token. Wait for the limit to reset, then try again.'
      : 'GitHub has temporarily limited requests from your connection. Wait for the limit to reset, or add a GitHub token and try again.')
    : 'GitHub has temporarily limited requests. Wait for the limit to reset, or restart the server with GITHUB_TOKEN set.';
  if (portable) message = message.replace(/\(GITHUB_TOKEN searches everywhere\)/g, '(some skills may be missed)');
  return message.replace(/GitHub rate limit reached;.*/i, guidance)
    .replace(/GitHub rejected the token in GITHUB_TOKEN/g, portable
      ? 'GitHub rejected this token. Replace or remove it in the GitHub token field, then try again.'
      : 'GitHub rejected the server token in GITHUB_TOKEN.');
}

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

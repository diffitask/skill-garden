import { renderSkillDocument, copyMarkdown } from './document.js';
import { createFlower, createBouquet } from './flowers.js';

const flowerStudy = document.querySelector('#flower-study');
for (const seed of ['garden-rose', 'garden-lilac', 'garden-gold', 'garden-blue', 'garden-coral']) {
  flowerStudy.append(createFlower(seed));
}

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
const filterInput = document.querySelector('#filter-skills');
const detail = document.querySelector('#detail');
let scanData = null;
let selectedSkill = null;
let skillButtons = new Map();
const copySkill = document.querySelector('#copy-skill');
const copyStatus = document.querySelector('#copy-status');
const documentContent = document.querySelector('#document-content');
let documentVersion = 0;
let copyFeedbackTimer = null;

function showDocumentView(markdown) {
  documentContent.hidden = markdown;
  document.querySelector('#content').hidden = !markdown;
  document.querySelector('#read-document').setAttribute('aria-pressed', String(!markdown));
  document.querySelector('#read-markdown').setAttribute('aria-pressed', String(markdown));
}

function resetDocumentControls() {
  documentVersion++;
  clearTimeout(copyFeedbackTimer);
  copySkill.textContent = 'Copy skill';
  copySkill.disabled = !selectedSkill;
  copyStatus.textContent = '';
  showDocumentView(false);
}

document.querySelector('#read-document').addEventListener('click', () => showDocumentView(false));
document.querySelector('#read-markdown').addEventListener('click', () => showDocumentView(true));
copySkill.addEventListener('click', async () => {
  if (!selectedSkill) return;
  const version = documentVersion;
  const original = selectedSkill.content;
  clearTimeout(copyFeedbackTimer);
  copyStatus.textContent = '';
  copySkill.textContent = 'Copy skill';
  copySkill.disabled = true;
  try {
    await copyMarkdown(original);
    if (version !== documentVersion) return;
    copySkill.textContent = 'Copied!';
    copyStatus.textContent = 'Original Markdown copied.';
    copyFeedbackTimer = setTimeout(() => {
      copySkill.textContent = 'Copy skill';
      copyStatus.textContent = '';
    }, 2500);
  } catch {
    if (version !== documentVersion) return;
    showDocumentView(true);
    const source = document.querySelector('#content');
    source.focus();
    const range = document.createRange();
    range.selectNodeContents(source);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    copyStatus.textContent = 'Copy unavailable. Markdown selected — press Ctrl+C or ⌘C to copy.';
  } finally {
    if (version === documentVersion) copySkill.disabled = false;
  }
});

filterInput.addEventListener('input', () => { if (scanData) renderSkills(); });
const clusterLevel = document.querySelector('#cluster-level');
clusterLevel.addEventListener('change', () => { if (scanData) renderSkills(); });
list.addEventListener('keydown', (event) => {
  const items = [...list.querySelectorAll('button')];
  const index = items.indexOf(event.target);
  if (index < 0) return;
  const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  const item = items[Math.max(0, Math.min(next, items.length - 1))];
  item.focus();
  item.click();
});

document.querySelector('#retry').addEventListener('click', () => form.requestSubmit());
addToken.addEventListener('click', () => {
  tokenInput.focus();
});

function selectSkill(skill, item) {
  for (const sibling of list.querySelectorAll('button')) sibling.removeAttribute('aria-current');
  item.setAttribute('aria-current', 'true');
  detail.hidden = false;
  if (selectedSkill === skill) return;
  selectedSkill = skill;
  resetDocumentControls();
  document.querySelector('#skill-name').textContent = skill.name;
  document.querySelector('#skill-flower').replaceChildren(createFlower(skill.id));
  document.querySelector('#skill-repository').textContent = skill.repository;
  renderDescription(skill.description);
  document.querySelector('#full-document').open = false;
  document.querySelector('#path').textContent = skill.path;
  document.querySelector('#content').textContent = skill.content;
  renderSkillDocument(documentContent, skill.content, skill.link);
  document.querySelector('#source').href = skill.link;
}

function clearSelection() {
  selectedSkill = null;
  resetDocumentControls();
  documentContent.replaceChildren();
  document.querySelector('#skill-flower').replaceChildren();
  detail.hidden = true;
  for (const id of ['skill-name', 'skill-repository', 'description', 'path', 'content']) document.getElementById(id).replaceChildren();
  document.querySelector('#source').removeAttribute('href');
  document.querySelector('#full-document').open = false;
}

function renderSkills() {
  // Same literal, per-field matching as core/filter.ts; never search paths or contents.
  const terms = filterInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (skill) => {
    const name = skill.name.toLowerCase();
    const description = (skill.description ?? '').toLowerCase();
    return terms.every((term) => name.includes(term) || description.includes(term));
  };
  const organization = scanData.organization;
  const total = scanData.skills.length;
  const shown = [];
  list.replaceChildren();
  skillButtons = new Map();
  for (const repo of organization ? scanData.repositories : [scanData]) {
    const repoSkills = repo.skills.filter(matches);
    if (organization && (repoSkills.length || !terms.length)) {
      const heading = document.createElement('h3');
      heading.textContent = `${repo.repository.id} · ${repoSkills.length} skills`;
      list.append(heading);
    }
    const groups = organization ? [
      ["In agents' folders", repoSkills.filter((skill) => skill.inAgentFolder)],
      ['Elsewhere', repoSkills.filter((skill) => !skill.inAgentFolder)],
    ] : [['', repoSkills]];
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
        title.className = 'skill-title';
        title.append(createFlower(skill.id), document.createTextNode(skill.name));
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
        skillButtons.set(skill.id, item);
        shown.push(skill);
      }
    }
  }
  document.querySelector('#count').textContent = `${shown.length} of ${total} ${total === 1 ? 'skill' : 'skills'}`;
  document.querySelector('#no-matches').hidden = shown.length !== 0;
  renderClusters(shown);
  const selectedIndex = Math.max(0, shown.indexOf(selectedSkill));
  if (shown.length) selectSkill(shown[selectedIndex], list.querySelectorAll('button')[selectedIndex]);
  else clearSelection();
}

/** Both cluster panels, limited to the skills the filter shows. */
function renderClusters(shown) {
  const byId = new Map(shown.map((skill) => [skill.id, skill]));
  const clustering = scanData.clusterings?.find((level) => level.name === clusterLevel.value) ?? { clusters: [], unclustered: [] };
  const words = renderClusterCards(document.querySelector('#cluster-list'), clustering, byId);
  document.querySelector('#cluster-count').textContent = `${words.count} ${words.count === 1 ? 'cluster' : 'clusters'}`;
  document.querySelector('#no-clusters').hidden = words.count !== 0 || !shown.length;
  document.querySelector('#unclustered').textContent = notClustered(words.alone);
  renderAiClusters(byId);
  document.querySelector('#clusters').hidden = !shown.length;
}

function notClustered(count) {
  return count ? `Not in a cluster: ${count} ${count === 1 ? 'skill' : 'skills'}` : '';
}

/** Cards of the clusters with shown members; returns how many clusters and lone skills are shown. */
function renderClusterCards(container, clustering, byId) {
  container.replaceChildren();
  let count = 0;
  for (const cluster of clustering.clusters) {
    const members = cluster.skills.map((id) => byId.get(id)).filter(Boolean);
    if (!members.length) continue;
    count++;
    const card = document.createElement('section');
    card.className = 'cluster';
    const heading = document.createElement('h5');
    const label = document.createElement('span');
    label.className = 'cluster-label';
    label.textContent = cluster.words.join(' · ');
    heading.append(createBouquet(cluster.skills), label);
    const size = document.createElement('span');
    size.className = 'cluster-size';
    size.textContent = `${members.length} ${members.length === 1 ? 'skill' : 'skills'}`;
    heading.append(' ', size);
    const skills = document.createElement('ul');
    for (const skill of members) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.append(createFlower(skill.id), document.createTextNode(skill.name));
      if (scanData.organization) button.title = skill.repository;
      button.addEventListener('click', () => {
        const target = skillButtons.get(skill.id);
        selectSkill(skill, target);
        document.querySelector('#skill-name').focus({ preventScroll: true });
        detail.scrollIntoView?.({ block: 'start' });
      });
      item.append(button);
      skills.append(item);
    }
    card.append(heading, skills);
    container.append(card);
  }
  return { count, alone: clustering.unclustered.filter((id) => byId.has(id)).length };
}

// AI clusters come from the local server, which runs `claude -p`; one answer per scan at a time.
let aiResult = null;
let aiRequest = 0;
const aiButton = document.querySelector('#ai-cluster');
const aiStatus = document.querySelector('#ai-status');
const aiError = document.querySelector('#ai-error');
const aiHelperUrl = document.querySelector('#ai-helper-url');
const aiPairingCode = document.querySelector('#ai-pairing-code');
const aiProgress = document.querySelector('#ai-progress');
const aiElapsed = document.querySelector('#ai-elapsed');
const aiProgressNote = document.querySelector('#ai-progress-note');
let aiProgressTimer = null;
for (const field of [aiHelperUrl, aiPairingCode]) field.addEventListener('input', () => { if (scanData) renderSkills(); });

function stopAiProgress() {
  clearInterval(aiProgressTimer);
  aiProgressTimer = null;
  aiProgress.hidden = true;
  aiElapsed.hidden = true;
}

function startAiProgress() {
  stopAiProgress();
  const startedAt = Date.now();
  aiProgress.hidden = false;
  aiElapsed.hidden = false;
  const update = () => {
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    aiElapsed.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} elapsed`;
    const note = seconds >= 30
      ? 'Still waiting for AI. Remaining time is unavailable; you can keep browsing.'
      : 'The full set is analyzed together; remaining time is unavailable.';
    if (aiProgressNote.textContent !== note) aiProgressNote.textContent = note;
  };
  update();
  aiProgressTimer = setInterval(update, 1000);
}

/** The portable page reaches `claude -p` through a local server it is paired with. */
function aiEndpoint() {
  if (typeof globalThis.skillAtlasScan !== 'function') return { url: '/api/ai-clusters', headers: {} };
  let base;
  try {
    base = new URL(aiHelperUrl.value.trim());
  } catch {
    throw new Error('Enter the AI helper address, such as http://127.0.0.1:3000.');
  }
  if (!/^https?:$/.test(base.protocol)) throw new Error('Enter the AI helper address, such as http://127.0.0.1:3000.');
  return { url: new URL('/api/ai-clusters', base).href, headers: { 'X-Skill-Atlas-Code': aiPairingCode.value.trim() } };
}

function renderAiClusters(byId) {
  const portable = typeof globalThis.skillAtlasScan === 'function';
  const busy = aiButton.hasAttribute('aria-busy');
  const unpaired = portable && !aiPairingCode.value.trim();
  aiButton.disabled = unpaired || busy || byId.size < 2;
  aiButton.textContent = busy ? 'Clustering…' : aiResult ? `Cluster ${byId.size} ${byId.size === 1 ? 'skill' : 'skills'} again` : `Cluster ${byId.size} ${byId.size === 1 ? 'skill' : 'skills'} with AI`;
  if (!busy && !aiResult && aiError.hidden) {
    aiStatus.textContent = byId.size < 2 ? 'AI clustering needs at least two shown skills.'
      : unpaired ? 'Paste the pairing code from npm start to cluster with AI.' : '';
  }
  const container = document.querySelector('#ai-cluster-list');
  if (!aiResult) {
    container.replaceChildren();
    document.querySelector('#ai-no-clusters').hidden = true;
    document.querySelector('#ai-unclustered').textContent = '';
    document.querySelector('#ai-cluster-count').textContent = 'Claude Haiku 4.5';
    return;
  }
  const ai = renderClusterCards(container, aiResult, byId);
  document.querySelector('#ai-cluster-count').textContent = `${ai.count} ${ai.count === 1 ? 'cluster' : 'clusters'}`;
  document.querySelector('#ai-no-clusters').hidden = ai.count !== 0;
  document.querySelector('#ai-unclustered').textContent = notClustered(ai.alone);
}

function resetAiClusters() {
  aiRequest++;
  stopAiProgress();
  aiResult = null;
  aiButton.removeAttribute('aria-busy');
  aiStatus.textContent = '';
  aiError.hidden = true;
  aiError.textContent = '';
}

aiButton.addEventListener('click', async () => {
  if (!scanData || aiButton.hasAttribute('aria-busy')) return;
  const skills = [...skillButtons.keys()].map((id) => scanData.skills.find((skill) => skill.id === id))
    .map(({ id, name, description }) => ({ id, name, description }));
  const request = ++aiRequest;
  aiButton.setAttribute('aria-busy', 'true');
  aiError.hidden = true;
  aiStatus.textContent = `Clustering ${skills.length} skills…`;
  startAiProgress();
  renderSkills();
  try {
    const endpoint = aiEndpoint();
    let response;
    try {
      response = await fetch(endpoint.url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...endpoint.headers }, body: JSON.stringify({ skills }),
      });
    } catch {
      throw new Error(endpoint.headers['X-Skill-Atlas-Code'] === undefined
        ? 'Could not reach the server. Check that it is still running, then try again.'
        : `Could not reach the AI helper at ${new URL(endpoint.url).origin}. Start it with npm start, check the address, then try again.`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'AI clustering failed.');
    if (request !== aiRequest) return;
    aiResult = data;
    aiStatus.textContent = `Claude Haiku 4.5 clustered ${skills.length} skills.`;
  } catch (error) {
    if (request !== aiRequest) return;
    aiError.textContent = error instanceof Error ? error.message : 'AI clustering failed.';
    aiError.hidden = false;
    aiStatus.textContent = 'AI clustering failed. See the error below.';
  } finally {
    if (request === aiRequest) {
      stopAiProgress();
      aiButton.removeAttribute('aria-busy');
      if (scanData) renderSkills();
    }
  }
});

function renderTestData(repositories) {
  const tests = document.querySelector('#test-data');
  for (const repo of repositories) {
    if (!repo.testDataLinks?.length) continue;
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
  document.querySelector('#empty-guide').hidden = true;
  warnings.hidden = true;
  warnings.textContent = '';
  for (const selector of ['#repo-name', '#count', '#skill-name', '#skill-repository', '#description', '#path', '#content']) {
    document.querySelector(selector).replaceChildren();
  }
  document.querySelector('#source').removeAttribute('href');
  list.replaceChildren();
  document.querySelector('#cluster-list').replaceChildren();
  resetAiClusters();
  clusterLevel.replaceChildren();
  scanData = null;
  filterInput.value = '';
  clearSelection();
  document.querySelector('#scan-summary').textContent = '';
  document.querySelector('#test-data').replaceChildren();
  try {
    const data = await loadRepository(input.value.trim());
    const organization = data.organization;
    const name = organization ? organization.name : data.repository.id;
    document.querySelector('#repo-name').textContent = name;
    warnings.textContent = data.warnings.map(formatFailure).join('\n');
    warnings.hidden = data.warnings.length === 0;
    if (organization) {
      const c = data.counts;
      document.querySelector('#scan-summary').textContent = `${name} · ${data.skills.length} skills · Repositories: ${c.discovered} discovered, ${c.scanned} successfully scanned, ${c.failed} failed, ${c.skipped} skipped`;
      status.textContent = data.partial ? `Partial results for ${name}. See repository warnings below.` : `Scanned organization ${name}.`;
    } else status.textContent = `Scanned ${name} at commit ${data.repository.commit.slice(0, 7)}.`;
    renderTestData(organization ? data.repositories : [data]);
    if (!data.skills.length) {
      empty.hidden = false;
      document.querySelector('#empty-title').textContent = data.partial ? 'No skills available from completed scans.' : 'No skills found.';
      document.querySelector('#empty-message').textContent = organization
        ? (data.partial ? 'Some repositories could not be fully scanned. Review the warnings and try again.'
          : data.counts.discovered ? 'This organization has no skills in its public repositories.' : 'This organization has no public repositories.')
        : 'This repository has no SKILL.md files. Try another repository.';
      return;
    }
    scanData = data;
    // Smaller repositories share fewer distinctive words, so they start with looser clusters.
    clusterLevel.replaceChildren(...(data.clusterings ?? []).map((level) => new Option(`${level.name} · ${level.clusters.length} ${level.clusters.length === 1 ? 'cluster' : 'clusters'}`, level.name)));
    clusterLevel.value = data.skills.length < 50 ? 'Loose' : 'Balanced';
    document.querySelector('#cluster-disclosure').open = true;
    renderSkills();
    results.hidden = false;
    results.scrollIntoView?.({ block: 'start' });
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
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    const icons = { overview: 'spark', details: 'notes', usage: 'target', cautions: 'shield' };
    use.setAttribute('href', `#icon-${icons[key]}`);
    icon.append(use);
    heading.prepend(icon);
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

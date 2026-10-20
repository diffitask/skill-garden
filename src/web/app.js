const form = document.querySelector('#repository-form');
const input = document.querySelector('#repository');
const button = document.querySelector('#scan');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const empty = document.querySelector('#empty');
const warnings = document.querySelector('#warnings');
const list = document.querySelector('#skills');

function selectSkill(skill, item) {
  for (const sibling of list.children) sibling.removeAttribute('aria-current');
  item.setAttribute('aria-current', 'true');
  document.querySelector('#skill-name').textContent = skill.name;
  document.querySelector('#description').textContent = skill.description;
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
    status.textContent = error instanceof Error ? error.message : 'Unable to scan the repository.';
  } finally {
    button.disabled = false;
    input.disabled = false;
    form.removeAttribute('aria-busy');
  }
});

async function loadRepository(repository) {
  // The portable HTML supplies a direct GitHub scanner; the server view uses its API.
  if (globalThis.skillAtlasScan) return globalThis.skillAtlasScan(repository);
  const response = await fetch(`/api/scan?repository=${encodeURIComponent(repository)}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to scan the repository.');
  return data;
}

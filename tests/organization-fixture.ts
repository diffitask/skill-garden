import type { Recording } from '../src/core/replay.ts';

export const ORG = 'https://github.com/Example';
export const API = 'https://api.github.com';
export const LIST = `${API}/orgs/Example/repos?type=public&per_page=100&page=1`;
export const doc = (repo: string) => `---\nname: same-name\ndescription: Skills from ${repo}. Use when testing.\n---\n# ${repo} instructions\n<script>throw new Error('unsafe')</script>`;
const blob = (path: string) => ({ path, type: 'blob', mode: '100644', sha: 'blob' });
export const entry = (name: string, extra = {}) => ({ full_name: `Example/${name}`, private: false, ...extra });

export function organizationFixture(): Recording {
  const recording: Recording = {
    [`${API}/users/Example`]: { status: 200, body: { login: 'Example', type: 'Organization' } },
    [LIST]: { status: 200, body: [entry('zebra', { archived: true }), entry('private', { private: true })],
      headers: { Link: `<${LIST.replace('&page=1', '&page=2')}>; rel="next"` } },
    [LIST.replace('&page=1', '&page=2')]: { status: 200, body: [entry('alpha', { fork: true }), entry('empty'), entry('failed'), entry('zebra')] },
    [`${API}/repos/Example/empty`]: { status: 200, body: { full_name: 'Example/empty', default_branch: 'main' } },
    [`${API}/repos/Example/empty/commits/main`]: { status: 409, body: { message: 'Git Repository is empty.' } },
    [`${API}/repos/Example/failed`]: { status: 404, body: { message: 'Not Found' } },
  };
  for (const name of ['alpha', 'zebra']) {
    const branch = name === 'alpha' ? 'release/default' : 'main';
    recording[`${API}/repos/Example/${name}`] = { status: 200, body: { full_name: `Example/${name}`, default_branch: branch } };
    recording[`${API}/repos/Example/${name}/commits/${branch}`] = { status: 200, body: { sha: `${name}-commit` } };
    recording[`${API}/repos/Example/${name}/git/trees/${name}-commit?recursive=1`] = { status: 200, body: {
      truncated: false, tree: [blob('.claude/skills/shared/SKILL.md'), blob('.agents/skills/shared/SKILL.md'),
        blob('docs/elsewhere/SKILL.md'), blob('tests/fixtures/broken/SKILL.md')],
    } };
    for (const path of ['.agents/skills/shared/SKILL.md', 'docs/elsewhere/SKILL.md']) {
      recording[`https://raw.githubusercontent.com/Example/${name}/${name}-commit/${path}`] = { status: 200,
        body: path.startsWith('docs') ? `---\nname: aaa-elsewhere\ndescription: Elsewhere.\n---\n# ${name} elsewhere` : doc(name) };
    }
    recording[`${API}/search/code?q=filename:SKILL.md+repo:Example/${name}&per_page=100&page=1`] = { status: 200, body: {
      total_count: 4, items: ['.claude/skills/shared/SKILL.md', '.agents/skills/shared/SKILL.md',
        'docs/elsewhere/SKILL.md', 'tests/fixtures/broken/SKILL.md'].map((path) => ({ path })),
    } };
  }
  return recording;
}

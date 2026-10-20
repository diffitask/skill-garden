import { AtlasError } from './errors.ts';
import { SKILL_ROOTS } from './find.ts';
import type { Source } from './scan.ts';

/** The part of `fetch` the core uses, so tests and the browser can pass their own. */
export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export type ScanProgress = { message: string; completed?: number; total?: number; skills?: number };

export type GitHubOptions = {
  onProgress?: (event: ScanProgress) => void;
  fetch: Fetch;
  /** By default, a token uses code search; without one, skills are found through the tree. */
  token?: string;
  /** Browser tokens can use tree discovery without code-search permissions. */
  discovery?: 'tree';
};

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

/** `https://github.com/owner/repo`, with or without the scheme, a trailing slash or `.git`. */
export function parseGitHubUrl(input: string): { owner: string; repo: string } | undefined {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(input.trim());
  return match ? { owner: match[1], repo: match[2] } : undefined;
}

/** A single GitHub account URL is an organization scan request. */
export function parseOrganizationUrl(input: string): string | undefined {
  return /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/?$/i.exec(input.trim())?.[1];
}

/** Validate the account before listing public repositories, including forks and archives. */
export async function discoverOrganization(input: string, options: GitHubOptions) {
  const name = parseOrganizationUrl(input);
  if (!name) throw new AtlasError('Enter a GitHub repository URL or organization URL.');
  options.onProgress?.({ message: `Checking organization ${name}…` });
  const github = client(options);
  const account = await github.json<{ login: string; type: string }>(
    `${API}/users/${name}`, `Organization not found: https://github.com/${name}`,
  );
  if (account.type !== 'Organization') {
    throw new AtlasError(`Organization scanning requires an organization; ${account.login} is a user account.`);
  }
  const repositories = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, next } = await github.page<{ full_name: string; private: boolean }[]>(
      `${API}/orgs/${account.login}/repos?type=public&per_page=100&page=${page}`,
    );
    for (const repo of data) if (repo.private === false) repositories.set(repo.full_name, `https://github.com/${repo.full_name}`);
    options.onProgress?.({ message: `Discovering repositories: page ${page}, ${repositories.size} public repositories found…` });
    if (!next && data.length < 100) break;
  }
  return { name: account.login, repositories: [...repositories.entries()].sort(([a], [b]) => {
    const x = a.toLowerCase(), y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
  }).map(([, url]) => url) };
}

/** Resolves the default branch to a commit and lists the files that may be skills. */
export async function openGitHub(input: string, options: GitHubOptions): Promise<Source> {
  const name = parseGitHubUrl(input);
  if (!name) throw new AtlasError(`Not a GitHub repository URL: ${input}`);
  const github = client(options);
  const info = await github.json<{ full_name: string; default_branch: string }>(
    `${API}/repos/${name.owner}/${name.repo}`,
    `Repository not found: https://github.com/${name.owner}/${name.repo}`,
  );
  const id = info.full_name;
  if (!info.default_branch) throw new AtlasError('Repository is empty; skipped');
  const { sha } = await github.json<{ sha: string }>(`${API}/repos/${id}/commits/${encodePath(info.default_branch)}`);
  const warnings: string[] = [];
  const paths = options.token && options.discovery !== 'tree' ? await searchPaths(github, id) : await treePaths(github, id, sha, warnings);
  const [organization, repo] = id.split('/');
  return {
    repository: { id, organization, name: repo, url: `https://github.com/${id}`, commit: sha },
    paths,
    warnings,
    read: (path) => github.raw(`${RAW}/${id}/${sha}/${encodePath(path)}`),
  };
}

/** Code search looks at the whole default branch, 100 results a page. */
async function searchPaths(github: Client, id: string): Promise<string[]> {
  const paths = new Set<string>(); // pages can repeat a result
  // GitHub returns at most 1000 results: ten pages.
  for (let page = 1; page <= 10; page++) {
    const result = await github.json<{ total_count: number; items: { path: string }[] }>(
      `${API}/search/code?q=filename:SKILL.md+repo:${id}&per_page=100&page=${page}`,
    );
    for (const item of result.items) paths.add(item.path);
    if (result.items.length < 100 || page * 100 >= result.total_count) break;
  }
  return [...paths];
}

type Tree = { truncated: boolean; tree: { path: string; mode: string; type: string; sha: string }[] };

/**
 * The whole tree at once. When it is too large for one answer: the part the answer
 * lists, wherever the files are, and the skill roots in full.
 */
async function treePaths(github: Client, id: string, sha: string, warnings: string[]): Promise<string[]> {
  const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${sha}?recursive=1`);
  if (!tree.truncated) return files(tree);
  warnings.push(
    `the tree is too large to list at once; looked in the part GitHub listed and in ${SKILL_ROOTS.join(', ')} (GITHUB_TOKEN searches everywhere)`,
  );
  const paths = new Set(files(tree)); // a skill root's files can be in the listed part too
  for (const root of SKILL_ROOTS) {
    const rootSha = await directory(github, id, sha, root);
    if (!rootSha) continue;
    const subtree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${rootSha}?recursive=1`);
    for (const path of files(subtree)) paths.add(`${root}/${path}`);
  }
  return [...paths];
}

/** Walks down one level at a time; the directory's tree, or undefined if it does not exist. */
async function directory(github: Client, id: string, sha: string, path: string): Promise<string | undefined> {
  let current = sha;
  for (const segment of path.split('/')) {
    const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${current}`);
    const entry = tree.tree.find((item) => item.path === segment && item.type === 'tree');
    if (!entry) return undefined;
    current = entry.sha;
  }
  return current;
}

/** Regular files only: a symbolic link's content is its target, not a SKILL.md. */
function files(tree: Tree): string[] {
  return tree.tree.filter((item) => item.type === 'blob' && item.mode !== '120000').map((item) => item.path);
}

type Client = ReturnType<typeof client>;

function client({ fetch, token, onProgress }: GitHubOptions) {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const redact = (text: string) => token ? text.replaceAll(token, '[redacted]') : text;
  const answers = new Map<string, Promise<unknown>>(); // the root tree is asked for once per skill root

  async function get(url: string, init?: { headers: Record<string, string> }): Promise<Response> {
    try {
      const path = new URL(url).pathname;
      const repo = path.split('/').slice(url.startsWith(RAW) ? 1 : 2, url.startsWith(RAW) ? 3 : 4).join('/');
      if (url.startsWith(RAW)) onProgress?.({ message: `Reading skill document: ${path.slice(1)}…` });
      else if (path.startsWith('/repos/')) onProgress?.({ message: `${path.includes('/git/trees/') ? 'Listing files' : path.includes('/commits/') ? 'Resolving default branch' : 'Opening repository'}: ${repo}…` });
      return await fetch(url, init);
    } catch (error) {
      throw new AtlasError(`Cannot reach GitHub: ${redact(describe(error))}`);
    }
  }

  async function request(url: string, notFound: string) {
    const response = await get(url, { headers });
    if (response.ok) return { data: await response.json(), next: /<[^>]+>;\s*rel="next"/.test(response.headers.get('link') ?? '') };
    const body: unknown = await response.json().catch(() => undefined);
    const message = (body as { message?: unknown } | undefined)?.message;
    const text = typeof message === 'string' ? message : '';
    if (response.status === 404) throw new AtlasError(notFound);
    if (response.status === 409) throw new AtlasError('Repository is empty; skipped');
    if (response.status === 429 || (response.status === 403 && (/rate limit/i.test(text) || response.headers.get('x-ratelimit-remaining') === '0'))) {
      throw new AtlasError(`GitHub rate limit reached; ${token ? 'try again in a minute' : 'set GITHUB_TOKEN'}`);
    }
    if (response.status === 401) throw new AtlasError('GitHub rejected the token in GITHUB_TOKEN');
    throw new AtlasError(`GitHub answered ${response.status} for ${url}${text && `: ${redact(text)}`}`);
  }

  return {
    /** A GitHub API answer; `notFound` explains a 404. */
    json<T>(url: string, notFound = `Not found on GitHub: ${url}`): Promise<T> {
      if (!answers.has(url)) answers.set(url, request(url, notFound).then((answer) => answer.data));
      return answers.get(url) as Promise<T>;
    },
    async page<T>(url: string): Promise<{ data: T; next: boolean }> {
      return request(url, `Organization discovery failed: ${url}`);
    },
    /** A file's bytes at the scanned commit, or undefined if it is not there. */
    async raw(url: string): Promise<Uint8Array | undefined> {
      const response = await get(url);
      if (response.status === 404) return undefined;
      if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
        throw new AtlasError('GitHub rate limit reached; try again in a minute');
      }
      if (!response.ok) throw new AtlasError(`GitHub answered ${response.status} for ${url}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}

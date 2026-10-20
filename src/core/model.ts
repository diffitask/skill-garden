/** A scanned repository. The hierarchy is organization → repository → skill. */
export type Repository = {
  /** `owner/name`, for example `JetBrains/kotlin`; a local directory's name. */
  id: string;
  organization: string;
  name: string;
  /** `https://github.com/<owner>/<repo>`, or a local directory's file:// URL. */
  url: string;
  /** The scanned commit; empty for a local directory. */
  commit: string;
};

/** One skill. Its link is derived, by `skillLink`. */
export type Skill = {
  /** `repo:path`, for example `JetBrains/kotlin:.claude/skills/x/SKILL.md`. */
  id: string;
  repository: string;
  path: string;
  name: string;
  description: string;
  /** The scanned commit, the one the link pins; empty for a local directory. */
  commit: string;
  /** The same skill in other agents' folders. */
  copies: string[];
  /** In a folder agents read skills from, such as `.claude/skills`; else anywhere else. */
  inAgentFolder: boolean;
};

/**
 * The SKILL.md file, from where its repository is: on GitHub at the scanned commit,
 * `https://github.com/<owner>/<repo>/blob/<commit>/<path>`; in a local directory, the file itself.
 */
export function skillLink(repository: Repository, skill: Skill): string {
  return fileLink(repository, skill.path);
}

/** A file of the repository, at the scanned commit on GitHub. */
export function fileLink(repository: Repository, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return repository.commit ? `${repository.url}/blob/${repository.commit}/${encoded}` : `${repository.url}/${encoded}`;
}

/** By name, then by path: the same order everywhere, whatever the locale. */
export function sortSkills(skills: Skill[]): Skill[] {
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...skills].sort((a, b) => compare(a.name, b.name) || compare(a.path, b.path));
}

/** A skill found in a repository: its SKILL.md, its name and its copies. */
export type SkillFile = { path: string; name: string; copies: string[] };

/** Where agents usually keep a repository's own skills: where a large tree is looked into. */
export const SKILL_ROOTS = ['.agents/skills', '.claude/skills', '.github/skills', 'agent/skills'];

/** The agents' shared folder: of a skill's copies, the one listed. */
const SHARED = '.agents';

/**
 * Every file named exactly SKILL.md, named after its directory (a SKILL.md at the
 * root after the repository). The same skill in several agents' folders next to each
 * other, such as `.agents/skills/x` and `.cursor/skills/x`, is one skill: the
 * `.agents` file, else the first by path, with the others as its copies.
 */
export function findSkills(paths: string[], repositoryName: string): SkillFile[] {
  const groups = new Map<string, string[]>();
  for (const path of paths.filter((path) => path.split('/').at(-1) === 'SKILL.md').sort()) {
    const key = copyKey(path) ?? path;
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  return [...groups.values()]
    .map((group) => [...group.filter(isShared), ...group.filter((path) => !isShared(path))])
    .map(([path, ...copies]) => ({ path, name: path.split('/').at(-2) ?? repositoryName, copies }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * `<place>/<agent folder>/skills/<name>/SKILL.md` without the agent folder: the same
 * for every copy. An agent folder is a dot folder, such as `.cursor`, or a skill root's.
 */
function copyKey(path: string): string | undefined {
  const match = /^((?:[^/]+\/)*)([^/]+)\/skills?\/([^/]+)\/SKILL\.md$/.exec(path);
  if (!match) return undefined;
  const [, place, folder, name] = match;
  if (!folder.startsWith('.') && !SKILL_ROOTS.some((root) => root.startsWith(`${folder}/`))) return undefined;
  return `${place}\0${name}`;
}

function isShared(path: string): boolean {
  return `/${path}`.includes(`/${SHARED}/`);
}

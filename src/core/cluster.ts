import type { Skill } from './model.ts';

/** Skills that share words, and the words they share most. */
export type Cluster = {
  /** Shared words, the most shared first: the cluster's label. */
  words: string[];
  /** Skill ids, in the order the skills were given. */
  skills: string[];
};

export type Clustering = {
  clusters: Cluster[];
  /** Skill ids that share too few words with any other skill. */
  unclustered: string[];
};

/** Words too common in skill descriptions to say what a skill is about. */
const STOP_WORDS = new Set(`
  a about after all also an and any are as at be been before but by can do does each else for from
  has have how if in into is it its may more must no not of on only or other our out over should so
  some such than that the their them then there these they this those through to up use used uses
  using via was way we what when where which while who will with within without you your
  skill skills agent agents claude file files run runs make makes help helps work works need needs
  every new one two get gets set sets like just`.split(/\s+/).filter(Boolean));

/**
 * The significant words of a skill's name and description: lowercase, split at anything
 * that is not a letter or digit, at least three characters, no stop words or numbers,
 * a trailing plural `s` removed (`reviews` → `review`, not `process`).
 */
export function skillWords(skill: Pick<Skill, 'name' | 'description'>): Set<string> {
  const words = new Set<string>();
  for (const raw of `${skill.name} ${skill.description ?? ''}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const word = raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw;
    if (word.length < 3 || /^\p{N}+$/u.test(word) || STOP_WORDS.has(word) || STOP_WORDS.has(raw)) continue;
    words.add(word);
  }
  return words;
}

/**
 * Group skills by shared words. Two skills are linked when they share at least `minShared`
 * significant words (see `skillWords`); a cluster is a connected group of linked skills.
 * Clusters are ordered by size, then label; skills keep the given order.
 */
export function clusterSkills(skills: Pick<Skill, 'id' | 'name' | 'description'>[], minShared = 2): Clustering {
  const words = skills.map(skillWords);
  const parent = skills.map((_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index])));
  for (let a = 0; a < skills.length; a++) {
    for (let b = a + 1; b < skills.length; b++) {
      let shared = 0;
      for (const word of words[a]) if (words[b].has(word) && ++shared >= minShared) break;
      if (shared >= minShared) parent[root(b)] = root(a);
    }
  }
  const groups = new Map<number, number[]>();
  skills.forEach((_, index) => groups.set(root(index), [...(groups.get(root(index)) ?? []), index]));
  const clusters: Cluster[] = [];
  const unclustered: string[] = [];
  for (const members of groups.values()) {
    if (members.length === 1) { unclustered.push(skills[members[0]].id); continue; }
    // The label: words in at least two members, by how many members share them.
    const counts = new Map<string, number>();
    for (const index of members) for (const word of words[index]) counts.set(word, (counts.get(word) ?? 0) + 1);
    const label = [...counts].filter(([, count]) => count >= 2)
      .sort(([a, x], [b, y]) => y - x || compare(a, b)).slice(0, 5).map(([word]) => word);
    clusters.push({ words: label, skills: members.map((index) => skills[index].id) });
  }
  clusters.sort((a, b) => b.skills.length - a.skills.length || compare(a.words.join(' '), b.words.join(' ')));
  return { clusters, unclustered };
}

/** The same order whatever the locale. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

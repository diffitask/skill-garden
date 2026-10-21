import type { Skill } from './model.ts';

/** Skills about the same topic, and the words that tell it. */
export type Cluster = {
  /** The most distinctive words the members share, the strongest first: the cluster's label. */
  words: string[];
  /** Skill ids, in the order the skills were given. */
  skills: string[];
};

export type Clustering = {
  clusters: Cluster[];
  /** Skill ids similar enough to no other skill. */
  unclustered: string[];
};

export type ClusterOptions = {
  /** The least average similarity, from 0 to 1, between two groups that are merged. */
  threshold?: number;
};

/** A clustering at one of the `CLUSTER_LEVELS`. */
export type ClusterLevel = Clustering & { name: string; threshold: number };

/** Words that say nothing about what a skill is about, in any repository. */
const STOP_WORDS = new Set(`
  a about above after again against all also always an and any anything are around as ask asked
  asks at be because been before being below between both but by can cannot could did do does
  doing done down during each either else even every everything few for from further get gets
  given gives has have having here how however if in including instead into is it its itself
  just like make makes making many may might more most much must need needed needs never new no
  nor not now of off often on once one only onto or other others otherwise our out over own per
  please rather really same say says see should since so some something such sure than that the
  their them themselves then there these they thing things this those though through thus to too
  two under until up upon use used useful user users uses using very via want wants was way ways
  we well were what whatever when whenever where whether which while who whom whose why will with
  within without would yet you your
  skill skills agent agents assistant claude ai llm task tasks help helps helping work works
  working run runs running provide provides providing support supports supporting handle handles
  specific specified various multiple different common general etc
  avoid apply applies applying create creates creating ensure ensures follow follows following
  include includes including perform performs produce produces require requires requiring
  manage manages managing`.split(/\s+/).filter(Boolean));

/** Added to a stem's term frequency when the skill's name has it: names are concise topics. */
const NAME_WEIGHT = 1;

/** Named similarity thresholds, from many loose clusters to few tight ones. */
export const CLUSTER_LEVELS = [
  { name: 'Loose', threshold: 0.08 },
  { name: 'Balanced', threshold: 0.12 },
  { name: 'Strict', threshold: 0.2 },
] as const;

/**
 * A word's stem by light suffix rules, so `tests`, `testing` and `tested` meet:
 * `-ies` → `-y`, `-es` after a sibilant, a plural `-s` (not `-ss`, `-us`, `-is`), or `-ing` and
 * `-ed` with a doubled final consonant undone (`mapped` → `map`).
 */
export function stem(word: string): string {
  if (/..ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/..(?:ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (/..[^sui]s$/.test(word)) return word.slice(0, -1);
  const result = /....ing$/.test(word) ? word.slice(0, -3) : /....ed$/.test(word) ? word.slice(0, -2) : word;
  return result !== word && /([^aeiouslz])\1$/.test(result) ? result.slice(0, -1) : result;
}

/** The significant words of a text, as they are written: no short words, numbers, or stop words. */
function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !/^\p{N}+$/u.test(word) && !STOP_WORDS.has(word));
}

/** How often each stem occurs in a skill's description, and whether it is in the name. */
function termCounts(skill: Pick<Skill, 'name' | 'description'>, surfaces: Map<string, Map<string, number>>) {
  const counts = new Map<string, { description: number; name: boolean }>();
  const add = (word: string, inName: boolean) => {
    const key = stem(word);
    const entry = counts.get(key) ?? { description: 0, name: false };
    counts.set(key, inName ? { ...entry, name: true } : { ...entry, description: entry.description + 1 });
    const forms = surfaces.get(key) ?? new Map<string, number>();
    surfaces.set(key, forms.set(word, (forms.get(word) ?? 0) + 1));
  };
  for (const word of words(skill.name)) add(word, true);
  for (const word of words(skill.description ?? '')) add(word, false);
  return counts;
}

/** The significant stems of a skill's name and description. */
export function skillWords(skill: Pick<Skill, 'name' | 'description'>): Set<string> {
  return new Set(termCounts(skill, new Map()).keys());
}

/**
 * Group skills by topic. Each skill is a TF-IDF vector of the stems in its name and description:
 * a stem weighs more the more often the skill uses it (sublinearly, plus one for the name) and
 * the fewer other skills use it, so words every skill in the repository uses barely count.
 * Similarity is the cosine of two vectors. Average-linkage agglomerative clustering then merges
 * the two most similar groups, by the mean similarity of all their pairs, while it reaches the
 * threshold: unlike chaining pairs, one broad skill cannot glue unrelated groups together.
 * Clusters are ordered by size, then label; skills keep the given order.
 */
export function clusterSkills(skills: Pick<Skill, 'id' | 'name' | 'description'>[], options: ClusterOptions = {}): Clustering {
  const { clusters, unclustered } = clusterLevels(skills, [{ name: '', threshold: options.threshold ?? 0.12 }])[0];
  return { clusters, unclustered };
}

/**
 * `clusterSkills` at several thresholds at once. Average-linkage merges only get less similar,
 * so one run of merges serves every threshold: each takes the merges that reach it.
 */
export function clusterLevels(
  skills: Pick<Skill, 'id' | 'name' | 'description'>[],
  levels: readonly { name: string; threshold: number }[] = CLUSTER_LEVELS,
): ClusterLevel[] {
  const n = skills.length;
  const surfaces = new Map<string, Map<string, number>>();
  const counts = skills.map((skill) => termCounts(skill, surfaces));
  const frequency = new Map<string, number>();
  for (const terms of counts) for (const term of terms.keys()) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  // Smoothed, so two skills sharing a word still count it in a repository of two.
  const idf = (term: string) => Math.log((n + 1) / frequency.get(term)!);
  const vectors = counts.map((terms) => {
    const vector = new Map<string, number>();
    for (const [term, { description, name }] of terms) {
      vector.set(term, ((description ? 1 + Math.log(description) : 0) + (name ? NAME_WEIGHT : 0)) * idf(term));
    }
    const norm = Math.hypot(...vector.values()) || 1;
    for (const [term, weight] of vector) vector.set(term, weight / norm);
    return vector;
  });
  const lowest = Math.min(...levels.map((level) => level.threshold));
  const merges = agglomerate(vectors, lowest);
  return levels.map(({ name, threshold }) => {
    // Replay the merges that reach this threshold; a group is named by its smallest index.
    const groups = skills.map((_, index) => [index]);
    for (const [a, b] of merges.filter((merge) => merge[2] >= threshold)) {
      groups[a].push(...groups[b]);
      groups[b] = [];
    }
    const clusters: Cluster[] = [];
    const unclustered: string[] = [];
    for (const group of groups) {
      if (group.length === 1) unclustered.push(skills[group[0]].id);
      if (group.length < 2) continue;
      group.sort((x, y) => x - y);
      clusters.push({ words: label(group, vectors, surfaces), skills: group.map((index) => skills[index].id) });
    }
    clusters.sort((x, y) => y.skills.length - x.skills.length || compare(x.words.join(' '), y.words.join(' ')));
    return { name, threshold, clusters, unclustered };
  });
}

/**
 * Merge the two most similar groups until no pair reaches the threshold. Returns the merges in
 * order, as `[kept group, merged group, similarity]`; the kept group has the smaller index.
 */
function agglomerate(vectors: Map<string, number>[], threshold: number): [number, number, number][] {
  const n = vectors.length;
  // Average similarity between active groups, kept up to date by the Lance–Williams formula.
  const similarity = new Float64Array(n * n);
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const [small, large] = vectors[a].size < vectors[b].size ? [vectors[a], vectors[b]] : [vectors[b], vectors[a]];
      let dot = 0;
      for (const [term, weight] of small) dot += weight * (large.get(term) ?? 0);
      similarity[a * n + b] = similarity[b * n + a] = dot;
    }
  }
  const sizes = new Array<number>(n).fill(1);
  const active = new Set(vectors.keys());
  // Each group's most similar other group, so a merge does not rescan every pair.
  const nearest = new Int32Array(n).fill(-1);
  const findNearest = (a: number) => {
    nearest[a] = -1;
    for (const b of active) {
      if (b !== a && (nearest[a] < 0 || similarity[a * n + b] > similarity[a * n + nearest[a]])) nearest[a] = b;
    }
  };
  for (const a of active) findNearest(a);
  const merges: [number, number, number][] = [];
  for (;;) {
    let best = -1;
    for (const a of active) {
      if (nearest[a] >= 0 && (best < 0 || similarity[a * n + nearest[a]] > similarity[best * n + nearest[best]])) best = a;
    }
    if (best < 0 || similarity[best * n + nearest[best]] < threshold) return merges;
    const [a, b] = [Math.min(best, nearest[best]), Math.max(best, nearest[best])];
    merges.push([a, b, similarity[a * n + b]]);
    active.delete(b);
    for (const k of active) {
      if (k !== a) similarity[a * n + k] = similarity[k * n + a] = (sizes[a] * similarity[a * n + k] + sizes[b] * similarity[b * n + k]) / (sizes[a] + sizes[b]);
    }
    sizes[a] += sizes[b];
    findNearest(a);
    for (const k of active) {
      if (k === a) continue;
      if (nearest[k] === a || nearest[k] === b) findNearest(k);
      else if (similarity[k * n + a] > similarity[k * n + nearest[k]]) nearest[k] = a;
    }
  }
}

/** Up to four stems at least two members share, by their total weight in the members, as written. */
function label(group: number[], vectors: Map<string, number>[], surfaces: Map<string, Map<string, number>>): string[] {
  const score = new Map<string, { weight: number; members: number }>();
  for (const index of group) {
    for (const [term, weight] of vectors[index]) {
      const entry = score.get(term) ?? { weight: 0, members: 0 };
      score.set(term, { weight: entry.weight + weight, members: entry.members + 1 });
    }
  }
  return [...score].filter(([, entry]) => entry.members >= 2)
    .sort(([x, p], [y, q]) => q.weight - p.weight || compare(x, y)).slice(0, 4)
    .map(([term]) => surface(surfaces.get(term)!));
}

/** How a stem is written most often, then the shortest way, then alphabetically. */
function surface(forms: Map<string, number>): string {
  return [...forms].sort(([x, p], [y, q]) => q - p || x.length - y.length || compare(x, y))[0][0];
}

/** The same order whatever the locale. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

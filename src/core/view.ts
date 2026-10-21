import { clusterLevels, type ClusterLevel } from './cluster.ts';
import { fileLink, skillLink } from './model.ts';
import { scan, type Source } from './scan.ts';

/** Capture documents during the existing scan; copies and test data are never read. */
export async function scanWithContents(source: Source) {
  const contents = new Map<string, string>();
  const result = await scan({ ...source, read: async (path) => {
    const bytes = await source.read(path);
    if (bytes) contents.set(path, new TextDecoder().decode(bytes));
    return bytes;
  } });
  return { ...result, testDataLinks: result.testData.map((path) => ({ path, link: fileLink(result.repository, path) })), skills: result.skills.map((skill) => ({
    ...skill, link: skillLink(result.repository, skill), content: contents.get(skill.path),
  })) };
}

/** Add topic clusters of every skill in the result, one repository or a whole organization, at each level. */
export function withClusters<T extends { skills: { id: string; name: string; description: string }[] }>(result: T): T & { clusterings: ClusterLevel[] } {
  return { ...result, clusterings: clusterLevels(result.skills) };
}

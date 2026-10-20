import { openGitHub } from './core/github.ts';
import { skillLink } from './core/model.ts';
import { scan } from './core/scan.ts';
import './web/app.js';

async function scanRepository(input: string) {
  const source = await openGitHub(input, { fetch });
  const contents = new Map<string, string>();
  const result = await scan({ ...source, read: async (path) => {
    const bytes = await source.read(path);
    if (bytes) contents.set(path, new TextDecoder().decode(bytes));
    return bytes;
  } });
  return { ...result, skills: result.skills.map((skill) => ({
    ...skill, link: skillLink(result.repository, skill), content: contents.get(skill.path),
  })) };
}

Object.assign(globalThis, { skillAtlasScan: scanRepository });

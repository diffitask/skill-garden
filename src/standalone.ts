import { openGitHub, type ScanProgress } from './core/github.ts';
import { scanTarget } from './core/target.ts';
import { scanWithContents } from './core/view.ts';
import './web/app.js';

async function scanRepository(input: string, token?: string, onProgress?: (event: ScanProgress) => void) {
  const github = { fetch, onProgress, token: token || undefined, discovery: 'tree' as const };
  return scanTarget(input, (url) => openGitHub(url, github), github, scanWithContents);
}

Object.assign(globalThis, { skillAtlasScan: scanRepository });

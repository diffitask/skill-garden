import { AtlasError } from './errors.ts';
import { discoverOrganization, openGitHub, parseOrganizationUrl, type GitHubOptions } from './github.ts';
import { scan, type ScanResult, type Source } from './scan.ts';

export type OrganizationResult<T extends ScanResult = ScanResult> = {
  organization: { name: string };
  repositories: T[];
  counts: { discovered: number; scanned: number; failed: number; skipped: number };
  skills: T['skills'];
  warnings: string[];
  partial: boolean;
};

/** Keep repository rules and identities isolated; aggregate only completed repository scans. */
export async function scanTarget<T extends ScanResult = ScanResult>(
  input: string,
  open: (input: string) => Promise<Source>,
  github?: GitHubOptions,
  scanSource: (source: Source) => Promise<T> = scan as (source: Source) => Promise<T>,
): Promise<T | OrganizationResult<T>> {
  if (!parseOrganizationUrl(input)) return scanSource(await open(input));
  if (!github) throw new AtlasError('Organization scanning requires GitHub access.');
  const organization = await discoverOrganization(input, github);
  const result: OrganizationResult<T> = {
    organization: { name: organization.name }, repositories: [],
    counts: { discovered: organization.repositories.length, scanned: 0, failed: 0, skipped: 0 },
    skills: [], warnings: [], partial: false,
  };
  for (const url of organization.repositories) {
    const id = url.slice('https://github.com/'.length);
    try {
      // Tree discovery covers forks and unindexed repositories even with a token.
      const repository = await scanSource(await openGitHub(url, { ...github, discovery: 'tree' }));
      result.repositories.push(repository);
      result.skills.push(...repository.skills);
      result.counts.scanned++;
      result.warnings.push(...repository.warnings.map((warning) => `${id}: ${warning}`));
      if (repository.warnings.some((warning) => /too large|listed, but not found/.test(warning))) result.partial = true;
    } catch (error) {
      if (!(error instanceof AtlasError)) throw error;
      if (/Repository is empty/.test(error.message)) result.counts.skipped++;
      else result.counts.failed++;
      result.warnings.push(`${id}: ${error.message}`);
      result.partial = true;
    }
  }
  return result;
}

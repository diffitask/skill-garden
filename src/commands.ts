// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { AtlasError } from './core/errors.ts';
import { filterSkills } from './core/filter.ts';
import { fileLink, skillLink, type Repository, type Skill } from './core/model.ts';
import type { Source } from './core/scan.ts';
import type { GitHubOptions } from './core/github.ts';
import { scanTarget } from './core/target.ts';

export type Context = {
  /** Opens a single repository URL or local directory. */
  open(input: string): Promise<Source>;
  /** GitHub transport and credentials for organization discovery and scans. */
  github?: GitHubOptions;
  print(text: string): void;
  /** Errors and warnings. */
  error(text: string): void;
};

const usage = `Usage: skill-atlas <command>

  scan <GitHub URL | directory> [--filter "words"]
                                  find skills in a repository, organization, or directory,
                                  optionally matching name and description
  help                            show this help`;

/** Runs one command; returns its exit code. */
export async function run(args: string[], context: Context): Promise<number> {
  const [command = 'help', ...rest] = args;
  try {
    if (command === 'scan') return await scanCommand(rest, context);
    else if (command === 'help') context.print(usage);
    else throw new AtlasError(`Unknown command: ${command}\n\n${usage}`);
    return 0;
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    context.error(error.message);
    return 1;
  }
}

async function scanCommand(args: string[], context: Context) {
  if (args.length !== 1 && !(args.length === 3 && args[1] === '--filter')) {
    throw new AtlasError('Usage: skill-atlas scan <GitHub URL | directory> [--filter "words"]');
  }
  const query = args[2] ?? '';
  const filtered = Boolean(query.trim());
  const result = await scanTarget(args[0], context.open, context.github);
  if ('organization' in result) {
    const { counts: c } = result;
    const repositories = result.repositories.map((repo) => ({ ...repo, skills: filterSkills(repo.skills, query) }));
    const total = repositories.reduce((sum, repo) => sum + repo.skills.length, 0);
    context.print(`${result.organization.name} · ${count(total)}${result.partial ? ' · PARTIAL RESULTS' : ''}`);
    context.print(`Repositories: ${c.discovered} discovered, ${c.scanned} successfully scanned, ${c.failed} failed, ${c.skipped} skipped`);
    for (const repo of repositories) printRepository(repo.repository, repo.skills, repo.testData, context);
    if (!c.discovered) context.print('No public repositories found.');
    else if (!result.skills.length) context.print(result.partial ? 'No skills found in the completed scans.' : 'No skills found.');
    else if (filtered && !total) context.print('No skills match your filter');
  } else printRepository(result.repository, filterSkills(result.skills, query), result.testData, context, filtered);
  for (const warning of result.warnings) context.error(`warning: ${warning}`);
  return 'partial' in result && result.partial ? 1 : 0;
}

/**
 * `<owner>/<repo> · N skills`, then each skill's name, first sentence and link: those
 * in agents' folders first, then those elsewhere, each group under its heading. Last,
 * the test data, not counted: only its links, so a test folder taken wrongly shows.
 */
function printRepository(repository: Repository, skills: Skill[], testData: string[], { print }: Context, filtered = false) {
  print(`${repository.id} · ${count(skills.length)}`);
  printGroup("In agents' folders", repository, skills.filter((skill) => skill.inAgentFolder), print);
  printGroup('Elsewhere', repository, skills.filter((skill) => !skill.inAgentFolder), print);
  if (filtered && !skills.length) print('No skills match your filter');
  if (testData.length === 0) return;
  print(`Test data, not skills · ${testData.length} ${testData.length === 1 ? 'file' : 'files'}`);
  for (const path of testData) print(`  ${fileLink(repository, path)}`);
}

function printGroup(heading: string, repository: Repository, skills: Skill[], print: (text: string) => void) {
  if (skills.length === 0) return;
  print(`${heading} · ${count(skills.length)}`);
  for (const skill of skills) {
    print(skill.description ? `${skill.name} — ${firstSentence(skill.description)}` : skill.name);
    print(`  ${skillLink(repository, skill)}`);
    if (skill.copies.length > 0) print(`  also in ${skill.copies.join(', ')}`);
  }
}

function count(skills: number): string {
  return `${skills} ${skills === 1 ? 'skill' : 'skills'}`;
}

function firstSentence(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
}

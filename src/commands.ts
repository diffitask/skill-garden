// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { AtlasError } from './core/errors.ts';
import { filterSkills } from './core/filter.ts';
import { fileLink, skillLink, type Repository, type Skill } from './core/model.ts';
import { scan, type Source } from './core/scan.ts';

export type Context = {
  /** Opens what the user asked to scan. */
  open(input: string): Promise<Source>;
  print(text: string): void;
  /** Errors and warnings. */
  error(text: string): void;
};

const usage = `Usage: skill-atlas <command>

  scan <GitHub URL | directory> [--filter "words"]
                                  find SKILL.md files, optionally matching name and description
  help                            show this help`;

/** Runs one command; returns its exit code. */
export async function run(args: string[], context: Context): Promise<number> {
  const [command = 'help', ...rest] = args;
  try {
    if (command === 'scan') await scanCommand(rest, context);
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
  const result = await scan(await context.open(args[0]));
  const skills = filterSkills(result.skills, args[2] ?? '');
  printRepository(result.repository, skills, result.testData, context, Boolean(args[2]?.trim()));
  for (const warning of result.warnings) context.error(`warning: ${warning}`);
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

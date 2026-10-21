import type { Recording } from '../src/core/replay.ts';

export const documentRepository = 'https://github.com/owner/reader';
export const documentCommit = 'reader-commit';
export const originalMarkdown = [
  '---', 'name: a-guide', 'description: Reads and reviews project documentation.', '---',
  '# A readable skill', '',
  'Read **carefully**, work *deliberately*, and run `npm test`.', '',
  '## Workflow', '',
  '1. Read the context.', '   - Check the requirements.', '2. Verify the result.', '',
  '> Keep the original wording.', '',
  '```sh', 'npm test', 'echo "<script>literal code</script>"', '```', '',
  '| Step | Purpose |', '| --- | --- |', '| Read | Understand |', '',
  '[Reference](./references/guide.md) · [Jump](#workflow)', '',
  '![Example diagram](https://example.com/diagram.png)', '',
  '[Unsafe](javascript:alert(1)) [Data](data:text/html,evil)', '',
  '<script>window.documentScriptRan = true</script>',
  '<img src="https://example.com/tracker" onerror="window.documentScriptRan=true">',
  '<style>body { display:none }</style><form id="repository-form"><input></form>',
  '<svg onload="window.documentScriptRan=true"></svg>', '',
  '## Workflow', '', 'A second section with the same title.', '',
].join('\r\n');
export const documentFiles = new Map([
  ['skills/a-guide/SKILL.md', originalMarkdown],
  ['skills/b-other/SKILL.md', '# Another skill\n\nDifferent instructions.\n'],
]);
export const documentRecording: Recording = {
  'https://api.github.com/repos/owner/reader': { status: 200, body: { full_name: 'owner/reader', default_branch: 'main' } },
  'https://api.github.com/repos/owner/reader/commits/main': { status: 200, body: { sha: documentCommit } },
  [`https://api.github.com/repos/owner/reader/git/trees/${documentCommit}?recursive=1`]: {
    status: 200, body: { truncated: false, tree: [...documentFiles.keys()].map((path) => ({ path, type: 'blob', mode: '100644', sha: 'file' })) },
  },
};
for (const [path, body] of documentFiles) {
  documentRecording[`https://raw.githubusercontent.com/owner/reader/${documentCommit}/${path}`] = { status: 200, body };
}

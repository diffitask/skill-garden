import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
const root = process.argv[2];
const { createWebServer } = await import(pathToFileURL(join(root, 'src/server.ts')).href);
const { replay } = await import(pathToFileURL(join(root, 'src/core/replay.ts')).href);
const data = JSON.parse(await readFile(new URL('./replay.json', import.meta.url), 'utf8'));
let calls = 0;
const server = createWebServer({
  github: { fetch: replay(data) },
  pairingCode: 'isolated-demo-fixture',
  ask: async ({ prompt }) => {
    calls++;
    if (!/^Cluster these 2 skills by topic\./.test(prompt)) throw new Error('Expected two submitted skills');
    await new Promise((resolve) => setTimeout(resolve, 1700));
    return { clusters: calls === 1 ? [{ label: 'Repository skills', skills: ['s1', 's2'] }] : [] };
  },
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}` })));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

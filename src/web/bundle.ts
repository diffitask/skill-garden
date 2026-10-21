import { build } from 'esbuild';

let script: Promise<string> | undefined;

/** Share the same bundled browser imports between every local server instance. */
export function browserApp(): Promise<string> {
  return script ??= build({
    entryPoints: [new URL('./app.js', import.meta.url).pathname],
    bundle: true, write: false, platform: 'browser', format: 'iife', minify: true,
  }).then((result) => result.outputFiles[0]!.text).catch((error) => {
    script = undefined;
    throw error;
  });
}

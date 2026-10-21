// Asks a model through the local Claude Code CLI in headless mode: `claude -p`.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { AtlasError } from './core/errors.ts';
import type { AskModel } from './core/ai-cluster.ts';

export type ClaudeOptions = {
  /** The CLI to run; `CLAUDE_BIN`, else `claude` on the PATH. */
  command?: string;
  /** How long one answer may take, in milliseconds. */
  timeout?: number;
};

/**
 * `claude -p` with structured output and no tools: the prompt goes in on stdin, never through a
 * shell, and nothing in it can run a tool. The JSON result's `structured_output` is the answer.
 */
export function askClaude(options: ClaudeOptions = {}): AskModel {
  const command = options.command ?? process.env.CLAUDE_BIN ?? 'claude';
  const timeout = options.timeout ?? 180_000;
  return ({ system, prompt, schema, model }) => new Promise((resolve, reject) => {
    const child = spawn(command, [
      '-p', '--model', model, '--output-format', 'json', '--json-schema', JSON.stringify(schema),
      '--system-prompt', system, '--tools', '', '--no-session-persistence',
    ], { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new AtlasError(`Claude did not answer within ${Math.round(timeout / 1000)} seconds. Try again.`));
    }, timeout);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new AtlasError(error.code === 'ENOENT'
        ? 'The claude command was not found. Install Claude Code and log in, or set CLAUDE_BIN, then restart the server.'
        : `Could not start claude: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let result: { is_error?: boolean; result?: unknown; structured_output?: unknown };
      try {
        result = JSON.parse(stdout);
      } catch {
        reject(new AtlasError(`claude failed${code ? ` with exit code ${code}` : ''}: ${(stderr || stdout).trim().slice(0, 300) || 'no output'}`));
        return;
      }
      if (result.is_error) {
        reject(new AtlasError(`Claude could not cluster the skills: ${String(result.result ?? 'unknown error').slice(0, 300)}`));
        return;
      }
      if (result.structured_output !== undefined) resolve(result.structured_output);
      else {
        // Older CLIs put the JSON in the text result, sometimes in a code fence.
        try {
          resolve(JSON.parse(String(result.result ?? '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')));
        } catch {
          reject(new AtlasError('Claude did not answer with JSON. Try again.'));
        }
      }
    });
    child.stdin.on('error', () => {}); // An early exit is reported by `close`.
    child.stdin.end(prompt);
  });
}

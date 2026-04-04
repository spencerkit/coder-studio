import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    workspace: process.cwd(),
    timeoutMs: 30000,
  };

  while (args.length > 0) {
    const current = args.shift();
    if (current === '--') {
      continue;
    }
    if (current === '--workspace') {
      const value = args.shift();
      if (!value) {
        throw new Error('missing value for --workspace');
      }
      options.workspace = path.resolve(value);
      continue;
    }
    if (current === '--timeout-ms') {
      const value = Number(args.shift());
      if (!Number.isFinite(value) || value < 1000) {
        throw new Error('invalid value for --timeout-ms');
      }
      options.timeoutMs = value;
      continue;
    }
    throw new Error(`unsupported argument: ${current}`);
  }

  return options;
}

function quoteForSingleShell(value) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

async function readJsonLines(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function waitFor(predicate, timeoutMs, label) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const result = await predicate();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function terminateChild(child) {
  if (child.exitCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

function runScriptCommand(workspace, command) {
  const child = spawn('script', ['-qefc', command, '/dev/null'], {
    cwd: workspace,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let transcript = '';
  child.stdout.on('data', (chunk) => {
    transcript += chunk.toString();
    if (transcript.length > 12000) {
      transcript = transcript.slice(-12000);
    }
  });
  child.stderr.on('data', (chunk) => {
    transcript += chunk.toString();
    if (transcript.length > 12000) {
      transcript = transcript.slice(-12000);
    }
  });

  return { child, getTranscript: () => transcript };
}

function codexHooksFeatureEnabled() {
  const result = spawnSync('codex', ['features', 'list'], {
    encoding: 'utf8',
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`failed to inspect codex features\n${(result.stderr || result.stdout || '').trim()}`.trim());
  }

  const line = result.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('codex_hooks'));

  if (!line) {
    throw new Error('codex features list did not report codex_hooks');
  }

  return line.split(/\s+/).at(-1) === 'true';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (process.platform === 'win32') {
    throw new Error('codex smoke script currently requires a Unix-like host with the `script` command');
  }

  const workspaceStat = await fs.stat(options.workspace).catch(() => null);
  if (!workspaceStat?.isDirectory()) {
    throw new Error(`workspace does not exist: ${options.workspace}`);
  }
  if (!codexHooksFeatureEnabled()) {
    throw new Error('codex_hooks is disabled for the current HOME; enable it globally in ~/.codex/config.toml before running this smoke test');
  }

  const hooksDir = path.join(os.homedir(), '.codex');
  const hooksPath = path.join(hooksDir, 'hooks.json');
  const existingHooks = await fs.readFile(hooksPath, 'utf8').catch(() => null);
  const hookLog = path.join(os.tmpdir(), `coder-studio-codex-hooks-${Date.now()}.jsonl`);
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startPrompt = `Reply with CODER_STUDIO_CODEX_START_${token} and nothing else.`;
  const resumePrompt = `Reply with CODER_STUDIO_CODEX_RESUME_${token} and nothing else.`;

  const hooksConfig = {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume',
          hooks: [
            {
              type: 'command',
              command: `/bin/sh -lc 'cat >> ${hookLog}; printf "\\n" >> ${hookLog}'`,
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: `/bin/sh -lc 'cat >> ${hookLog}; printf "\\n" >> ${hookLog}'`,
            },
          ],
        },
      ],
    },
  };

  process.stdout.write(`[codex-hooks-smoke] workspace: ${options.workspace}\n`);
  process.stdout.write('[codex-hooks-smoke] requires a trusted workspace plus working Codex auth\n');
  process.stdout.write(`[codex-hooks-smoke] global hooks: ${hooksPath}\n`);

  await fs.mkdir(hooksDir, { recursive: true });
  await fs.writeFile(hooksPath, `${JSON.stringify(hooksConfig, null, 2)}\n`);

  try {
    const startCommand = [
      'codex',
      '--no-alt-screen',
      '--full-auto',
      quoteForSingleShell(startPrompt),
    ].join(' ');
    process.stdout.write(`[codex-hooks-smoke] start: ${startCommand}\n`);
    const startRun = runScriptCommand(options.workspace, startCommand);
    let startState;
    try {
      startState = await waitFor(async () => {
        const entries = await readJsonLines(hookLog);
        const promptEntry = entries.find((entry) => entry.hook_event_name === 'UserPromptSubmit' && entry.prompt === startPrompt);
        if (!promptEntry) {
          return null;
        }
        const sessionStartEntry = entries.find(
          (entry) => entry.hook_event_name === 'SessionStart'
            && entry.source === 'startup'
            && entry.session_id === promptEntry.session_id,
        );
        if (!sessionStartEntry) {
          return null;
        }
        return { sessionId: promptEntry.session_id, transcriptPath: promptEntry.transcript_path };
      }, options.timeoutMs, 'startup hook payload');
    } catch (error) {
      throw new Error(`${error.message}\n\nLast transcript:\n${startRun.getTranscript()}`.trimEnd());
    }
    await terminateChild(startRun.child);

    process.stdout.write(`[codex-hooks-smoke] startup session_id: ${startState.sessionId}\n`);

    const resumeCommand = [
      'codex',
      'resume',
      startState.sessionId,
      '--no-alt-screen',
      '--full-auto',
      quoteForSingleShell(resumePrompt),
    ].join(' ');
    process.stdout.write(`[codex-hooks-smoke] resume: ${resumeCommand}\n`);
    const resumeRun = runScriptCommand(options.workspace, resumeCommand);
    try {
      await waitFor(async () => {
        const entries = await readJsonLines(hookLog);
        const promptEntry = entries.find((entry) => entry.hook_event_name === 'UserPromptSubmit' && entry.prompt === resumePrompt);
        if (!promptEntry || promptEntry.session_id !== startState.sessionId) {
          return null;
        }
        const sessionStartEntry = entries.find(
          (entry) => entry.hook_event_name === 'SessionStart'
            && entry.source === 'resume'
            && entry.session_id === startState.sessionId,
        );
        if (!sessionStartEntry) {
          return null;
        }
        return true;
      }, options.timeoutMs, 'resume hook payload');
    } catch (error) {
      throw new Error(`${error.message}\n\nLast transcript:\n${resumeRun.getTranscript()}`.trimEnd());
    }
    await terminateChild(resumeRun.child);

    const historyPath = path.join(os.homedir(), '.codex', 'history.jsonl');
    const historyEntries = await readJsonLines(historyPath);
    const startHistory = historyEntries.find((entry) => entry.text === startPrompt);
    const resumeHistory = historyEntries.find((entry) => entry.text === resumePrompt);

    assert.equal(startHistory?.session_id, startState.sessionId, 'startup prompt should persist under captured session_id');
    assert.equal(resumeHistory?.session_id, startState.sessionId, 'resume prompt should persist under the same session_id');

    process.stdout.write('[codex-hooks-smoke] smoke passed\n');
    process.stdout.write(
      `${JSON.stringify({
        session_id: startState.sessionId,
        transcript_path: startState.transcriptPath,
        workspace: options.workspace,
      }, null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(`[codex-hooks-smoke] ${error.message}\n`);
    throw error;
  } finally {
    if (existingHooks === null) {
      await fs.rm(hooksPath, { force: true });
    } else {
      await fs.writeFile(hooksPath, existingHooks);
    }
    await fs.rm(hookLog, { force: true });
  }
}

main().catch(() => {
  process.exitCode = 1;
});

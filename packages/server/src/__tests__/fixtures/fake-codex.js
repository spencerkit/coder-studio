#!/usr/bin/env node
/**
 * Fake Codex for integration tests.
 *
 * - Parses `-c notify=[...]` and stores the command array.
 * - Writes a rollout fixture under the provided HOME/.codex/sessions/...
 * - Spawns the notify command with an agent-turn-complete payload as
 *   the last argv token (matching Codex's notify contract).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
let notifyCmd = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '-c' && argv[i + 1]?.startsWith('notify=')) {
    try {
      notifyCmd = JSON.parse(argv[i + 1].slice('notify='.length));
    } catch {}
    break;
  }
}

const home = process.env.HOME;
const threadId = process.env.FAKE_CODEX_THREAD_ID || 'fake-uuid-1';
const turnId = 'turn-1';

// Write rollout fixture under today's date (computed at runtime)
const now = new Date();
const yyyy = String(now.getFullYear());
const mm = String(now.getMonth() + 1).padStart(2, '0');
const dd = String(now.getDate()).padStart(2, '0');
const rolloutDir = path.join(home, '.codex', 'sessions', yyyy, mm, dd);
fs.mkdirSync(rolloutDir, { recursive: true });
const rolloutPath = path.join(rolloutDir, `rollout-${yyyy}-${mm}-${dd}T10-${threadId}.jsonl`);
fs.writeFileSync(rolloutPath, JSON.stringify({ turn: 1 }) + '\n');

if (!notifyCmd) process.exit(0);

const payload = {
  type: 'agent-turn-complete',
  'thread-id': threadId,
  'turn-id': turnId,
  'input-messages': ['hi'],
  'last-assistant-message': 'hello',
};

const finalArgv = [...notifyCmd.slice(1), JSON.stringify(payload)];
const env = { ...process.env, CODER_STUDIO_SESSION_ID: process.env.CODER_STUDIO_SESSION_ID || '' };
spawnSync(notifyCmd[0], finalArgv, { stdio: 'inherit', env });

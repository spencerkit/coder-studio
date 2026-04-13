import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PNPM_CMD = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const MEASURE_PREFIX = '__TRANSPORT_BURST_MEASURE__ ';
const SCENARIO_GREP = {
  agent: 'high-frequency agent stdout is coalesced',
  terminal: 'high-frequency terminal output is coalesced',
  mixed: 'mixed agent and terminal burst workloads stay within bounded websocket frames',
};

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    scenarios: ['agent', 'terminal', 'mixed'],
    chunks: [24, 48, 96],
    intervalMs: 2,
    backendPortBase: 44033,
    frontendPortBase: 5474,
  };

  while (args.length > 0) {
    const current = args.shift();
    if (current === '--') {
      continue;
    }
    if (current === '--chunks') {
      const value = args.shift();
      if (!value) {
        throw new Error('missing value for --chunks');
      }
      const parsed = value
        .split(',')
        .map((entry) => Number.parseInt(entry.trim(), 10))
        .filter((entry) => Number.isFinite(entry) && entry > 0);
      if (parsed.length === 0) {
        throw new Error('invalid value for --chunks');
      }
      options.chunks = parsed;
      continue;
    }
    if (current === '--scenarios') {
      const value = args.shift();
      if (!value) {
        throw new Error('missing value for --scenarios');
      }
      const parsed = value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (parsed.length === 0 || parsed.some((entry) => !(entry in SCENARIO_GREP))) {
        throw new Error('invalid value for --scenarios');
      }
      options.scenarios = parsed;
      continue;
    }
    if (current === '--interval-ms') {
      const value = Number.parseInt(args.shift() ?? '', 10);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('invalid value for --interval-ms');
      }
      options.intervalMs = value;
      continue;
    }
    if (current === '--backend-port-base') {
      const value = Number.parseInt(args.shift() ?? '', 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('invalid value for --backend-port-base');
      }
      options.backendPortBase = value;
      continue;
    }
    if (current === '--frontend-port-base') {
      const value = Number.parseInt(args.shift() ?? '', 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('invalid value for --frontend-port-base');
      }
      options.frontendPortBase = value;
      continue;
    }
    throw new Error(`unsupported argument: ${current}`);
  }

  return options;
}

function quoteForCmd(value) {
  if (value.length === 0) {
    return '""';
  }
  if (!/[\s"&^|<>()]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function resolveSpawn(command, args) {
  if (process.platform === 'win32' && command.toLowerCase().endsWith('.cmd')) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', [command, ...args].map(quoteForCmd).join(' ')],
    };
  }

  return { command, args };
}

function runScenario({ scenario, chunkCount, intervalMs, backendPort, frontendPort }) {
  return new Promise((resolve, reject) => {
    const args = [
      'exec',
      'playwright',
      'test',
      'tests/e2e/transport.spec.ts',
      '--grep',
      SCENARIO_GREP[scenario],
    ];
    const resolved = resolveSpawn(PNPM_CMD, args);
    const output = [];

    process.stdout.write(
      `\n[ws-transport-profile] scenario=${scenario} chunks=${chunkCount} interval_ms=${intervalMs} ports=${backendPort}/${frontendPort}\n`,
    );
    process.stdout.write(`[ws-transport-profile] ${PNPM_CMD} ${args.join(' ')}\n`);

    const child = spawn(resolved.command, resolved.args, {
      cwd: ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        CODER_STUDIO_DEV_BACKEND_PORT: String(backendPort),
        CODER_STUDIO_DEV_FRONTEND_PORT: String(frontendPort),
        CODER_STUDIO_TEST_BURST_CHUNKS: String(chunkCount),
        CODER_STUDIO_TEST_BURST_INTERVAL_MS: String(intervalMs),
        CODER_STUDIO_TEST_BURST_MAX_FRAMES: String(chunkCount),
        CODER_STUDIO_TEST_TERMINAL_BURST_MAX_FRAMES: String(chunkCount),
        CODER_STUDIO_TEST_MIXED_BURST_MAX_TOTAL_FRAMES: String(chunkCount * 2),
        CODER_STUDIO_TEST_BURST_EMIT_MEASURE: '1',
      },
    });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output.push(text);
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output.push(text);
      process.stderr.write(text);
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      const transcript = output.join('');
      if (code !== 0) {
        reject(
          new Error(
            `scenario failed for ${scenario} chunks=${chunkCount}: ${signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`}\n${transcript}`.trimEnd(),
          ),
        );
        return;
      }

      const measureLine = transcript
        .split(/\r?\n/)
        .find((line) => line.startsWith(MEASURE_PREFIX));
      if (!measureLine) {
        reject(new Error(`missing transport measure output for ${scenario} chunks=${chunkCount}`));
        return;
      }

      try {
        const measure = JSON.parse(measureLine.slice(MEASURE_PREFIX.length));
        resolve(measure);
      } catch (error) {
        reject(new Error(`failed to parse transport measure output for ${scenario} chunks=${chunkCount}: ${error}`));
      }
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = [];

  let runIndex = 0;
  for (const scenario of options.scenarios) {
    for (const chunkCount of options.chunks) {
      const result = await runScenario({
        scenario,
        chunkCount,
        intervalMs: options.intervalMs,
        backendPort: options.backendPortBase + (runIndex * 10),
        frontendPort: options.frontendPortBase + (runIndex * 10),
      });
      results.push(result);
      runIndex += 1;
    }
  }

  process.stdout.write('\n[ws-transport-profile] summary\n');
  for (const result of results) {
    const ratio = (result.frameCount / result.chunkCount).toFixed(3);
    process.stdout.write(
      `[ws-transport-profile] scenario=${result.scenario} chunks=${result.chunkCount} frames=${result.frameCount} ratio=${ratio} interval_ms=${result.intervalMs} text_length=${result.textLength}${result.agentFrameCount ? ` agent_frames=${result.agentFrameCount}` : ''}${result.terminalFrameCount ? ` terminal_frames=${result.terminalFrameCount}` : ''}\n`,
    );
  }
  process.stdout.write(`${MEASURE_PREFIX}${JSON.stringify(results)}\n`);
}

main().catch((error) => {
  process.stderr.write(`\n[ws-transport-profile] ${error.message}\n`);
  process.exitCode = 1;
});

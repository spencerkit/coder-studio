/**
 * Tests for bridge script retry behavior on failed POST requests.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateBridgeScript } from '../hooks/bridge.js';

const createTempHome = () => {
  const tempHome = mkdtempSync(join(tmpdir(), 'cs-bridge-retry-'));
  const runtimeDir = join(tempHome, '.coder-studio');
  mkdirSync(runtimeDir, { recursive: true });
  return { tempHome, runtimeDir };
};

const writeRuntime = (runtimeDir: string, port: number) => {
  writeFileSync(
    join(runtimeDir, 'runtime.json'),
    JSON.stringify({
      host: '127.0.0.1',
      port,
      pid: process.pid,
      token: 'test-token',
      serverInstanceId: 'bridge-test',
      startedAt: Date.now(),
    }),
    'utf-8'
  );
};

const writeBridgeScript = (tempHome: string, providerId: string) => {
  const scriptPath = join(tempHome, `${providerId}-bridge.js`);
  writeFileSync(scriptPath, generateBridgeScript(providerId), 'utf-8');
  return scriptPath;
};

const waitForChildExit = async (child: ReturnType<typeof spawn>) => {
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', () => resolve());
  });
};

const trackedTempHomes: string[] = [];

afterEach(() => {
  for (const tempHome of trackedTempHomes.splice(0)) {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

describe('bridge retry behavior', () => {
  it('should retry failed POST requests 3 times after the initial attempt', async () => {
    const { tempHome, runtimeDir } = createTempHome();
    trackedTempHomes.push(tempHome);

    let attemptCount = 0;

    await new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        attemptCount++;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      });

      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to resolve bridge test server address'));
          return;
        }

        writeRuntime(runtimeDir, address.port);
        const scriptPath = writeBridgeScript(tempHome, 'claude');
        const child = spawn(process.execPath, [scriptPath, 'SessionStart'], {
          env: {
            ...process.env,
            HOME: tempHome,
            CODER_STUDIO_SESSION_ID: 'sess-bridge-1',
          },
          stdio: ['pipe', 'ignore', 'ignore'],
        });

        child.stdin.end(JSON.stringify({ resumeId: 'resume-1' }));

        waitForChildExit(child)
          .then(async () => {
            await new Promise<void>((closeResolve, closeReject) => {
              server.close((error) => {
                if (error) {
                  closeReject(error);
                  return;
                }
                closeResolve();
              });
            });
            resolve();
          })
          .catch(reject);
      });
    });

    expect(attemptCount).toBe(4);
  }, 10000);

  it('should include single-settlement retry logic in generated script content', () => {
    const script = generateBridgeScript('claude');

    expect(script).toContain('const maxAttempts = 4;');
    expect(script).toContain('let settled = false;');
    expect(script).toContain('const settle = (shouldRetry) => {');
    expect(script).toContain('if (settled) return;');
  });

  it('should not retry on successful POST request', async () => {
    const { tempHome, runtimeDir } = createTempHome();
    trackedTempHomes.push(tempHome);

    let attemptCount = 0;

    await new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        attemptCount++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });

      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to resolve bridge test server address'));
          return;
        }

        writeRuntime(runtimeDir, address.port);
        const scriptPath = writeBridgeScript(tempHome, 'claude');
        const child = spawn(process.execPath, [scriptPath, 'SessionStart'], {
          env: {
            ...process.env,
            HOME: tempHome,
            CODER_STUDIO_SESSION_ID: 'sess-bridge-2',
          },
          stdio: ['pipe', 'ignore', 'ignore'],
        });

        child.stdin.end(JSON.stringify({ resumeId: 'resume-2' }));

        waitForChildExit(child)
          .then(async () => {
            await new Promise<void>((closeResolve, closeReject) => {
              server.close((error) => {
                if (error) {
                  closeReject(error);
                  return;
                }
                closeResolve();
              });
            });
            resolve();
          })
          .catch(reject);
      });
    });

    expect(attemptCount).toBe(1);
  }, 10000);
});

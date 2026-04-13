// @ts-nocheck
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function escapeSystemdPath(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/ /g, '\\ ');
}

const SYSTEMD_USER_GUIDE = [
  'This machine does not have a systemd user session available.',
  'To manage Coder Studio as a background service, you need systemd running in user mode.',
  '',
  'Fix options:',
  '',
  '1) Desktop Linux (GNOME, KDE, etc.):',
  '   Ensure your login session uses systemd as the init system.',
  '   Most modern distributions enable this by default.',
  '',
  '2) WSL 2 (Windows Subsystem for Linux):',
  '   Create or edit /etc/wsl.conf and add:',
  '     [boot]',
  '     systemd=true',
  '   Then restart WSL from PowerShell: wsl --shutdown',
  '',
  '3) Containers / Docker:',
  '   User-mode systemd is typically not available inside containers.',
  '   Run Coder Studio directly instead: coder-studio start --foreground',
  '',
  '4) Systems without systemd:',
  '   Skip the managed service and launch directly:',
  '     coder-studio start --no-service',
  '   Or run the server binary in the foreground:',
  '     coder-studio start --foreground',
].join('\n');

async function assertSystemdUserAvailable(execute) {
  try {
    await execute('systemctl', ['--user', 'is-system-running'], { allowFailure: true });
  } catch {
    // Even if is-system-running fails, systemctl --user might still work.
    // Try a lightweight show command as a secondary check.
  }
  const result = await execute('systemctl', ['--user', 'status', '--no-pager'], { allowFailure: true });
  if ((result.code ?? 999) !== 0 && (!result.stdout || result.stdout.trim().length === 0)) {
    throw new Error(SYSTEMD_USER_GUIDE);
  }
}

async function defaultExecute(command, args, { allowFailure = false } = {}) {
  try {
    const result = await execFileAsync(command, args, { windowsHide: true });
    return {
      code: 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  } catch (error) {
    if (allowFailure && error && typeof error === 'object' && typeof error.code === 'number') {
      return {
        code: error.code,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? '',
      };
    }
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function resolveSystemdUserDir(homeDir = os.homedir()) {
  return path.join(homeDir, '.config', 'systemd', 'user');
}

export function resolveSystemdUserUnitName(serviceName) {
  return serviceName.endsWith('.service') ? serviceName : `${serviceName}.service`;
}

export function resolveSystemdUserUnitPath(serviceName, homeDir = os.homedir()) {
  return path.join(resolveSystemdUserDir(homeDir), resolveSystemdUserUnitName(serviceName));
}

export function createLinuxSystemdUserServiceAdapter({ execute = defaultExecute, homeDir = os.homedir() } = {}) {
  return {
    id: 'linux-systemd-user',

    async install({ serviceName, launcherPath, stateDir }) {
      await assertSystemdUserAvailable(execute);
      const serviceTarget = resolveSystemdUserUnitName(serviceName);
      const definitionPath = resolveSystemdUserUnitPath(serviceName, homeDir);
      const unitContents = `[Unit]
Description=Coder Studio
After=default.target

[Service]
Type=simple
ExecStart=${escapeSystemdPath(launcherPath)}
WorkingDirectory=${escapeSystemdPath(stateDir)}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`;

      await fs.mkdir(path.dirname(definitionPath), { recursive: true });
      await fs.writeFile(definitionPath, unitContents, 'utf8');
      await execute('systemctl', ['--user', 'daemon-reload']);
      await execute('systemctl', ['--user', 'enable', serviceTarget]);

      return {
        definitionPath,
        serviceTarget,
      };
    },

    async uninstall({ serviceName }) {
      const serviceTarget = resolveSystemdUserUnitName(serviceName);
      const definitionPath = resolveSystemdUserUnitPath(serviceName, homeDir);

      await execute('systemctl', ['--user', 'disable', '--now', serviceTarget], { allowFailure: true });
      await fs.rm(definitionPath, { force: true });
      await execute('systemctl', ['--user', 'daemon-reload']);

      return {
        definitionPath,
        serviceTarget,
      };
    },

    async start({ serviceName }) {
      await assertSystemdUserAvailable(execute);
      const serviceTarget = resolveSystemdUserUnitName(serviceName);
      await execute('systemctl', ['--user', 'start', serviceTarget]);
      return { serviceTarget };
    },

    async stop({ serviceName }) {
      const serviceTarget = resolveSystemdUserUnitName(serviceName);
      await execute('systemctl', ['--user', 'stop', serviceTarget], { allowFailure: true });
      return { serviceTarget };
    },

    async restart({ serviceName }) {
      await assertSystemdUserAvailable(execute);
      const serviceTarget = resolveSystemdUserUnitName(serviceName);
      await execute('systemctl', ['--user', 'restart', serviceTarget]);
      return { serviceTarget };
    },

    async status({ serviceName }) {
      const serviceTarget = resolveSystemdUserUnitName(serviceName);
      const definitionPath = resolveSystemdUserUnitPath(serviceName, homeDir);
      const definitionExists = await pathExists(definitionPath);

      let loadState = definitionExists ? 'loaded' : 'not-found';
      let activeState = 'inactive';
      let unitFileState = definitionExists ? 'disabled' : 'not-found';

      if (definitionExists) {
        const result = await execute(
          'systemctl',
          [
            '--user',
            'show',
            serviceTarget,
            '--property=LoadState',
            '--property=ActiveState',
            '--property=UnitFileState',
            '--value',
          ],
          { allowFailure: true },
        );
        const [resolvedLoadState, resolvedActiveState, resolvedUnitFileState] = String(result.stdout || '')
          .trim()
          .split(/\r?\n/);

        if (resolvedLoadState) loadState = resolvedLoadState;
        if (resolvedActiveState) activeState = resolvedActiveState;
        if (resolvedUnitFileState) unitFileState = resolvedUnitFileState;
      }

      return {
        installed: definitionExists && loadState !== 'not-found',
        active: activeState === 'active' || activeState === 'activating' || activeState === 'reloading',
        enabled: unitFileState.startsWith('enabled'),
        loadState,
        activeState,
        unitFileState,
        definitionPath,
        serviceTarget,
      };
    },
  };
}

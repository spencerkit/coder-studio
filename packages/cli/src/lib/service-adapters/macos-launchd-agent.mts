// @ts-nocheck
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
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

function resolveLaunchDomain(uid) {
  if (!Number.isInteger(uid) || uid < 0) {
    throw new Error('launchd_requires_numeric_uid');
  }
  return `gui/${uid}`;
}

export function resolveLaunchAgentsDir(homeDir = os.homedir()) {
  return path.join(homeDir, 'Library', 'LaunchAgents');
}

export function resolveLaunchAgentPlistPath(serviceName, homeDir = os.homedir()) {
  return path.join(resolveLaunchAgentsDir(homeDir), `${serviceName}.plist`);
}

export function resolveLaunchAgentTarget(serviceName, uid) {
  return `${resolveLaunchDomain(uid)}/${serviceName}`;
}

export function createMacosLaunchdAgentServiceAdapter({
  execute = defaultExecute,
  homeDir = os.homedir(),
  uid = typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  return {
    id: 'macos-launchd-agent',

    async install({ serviceName, launcherPath, stateDir }) {
      const definitionPath = resolveLaunchAgentPlistPath(serviceName, homeDir);
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(serviceName)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(launcherPath)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(stateDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;

      await fs.mkdir(path.dirname(definitionPath), { recursive: true });
      await fs.writeFile(definitionPath, plist, 'utf8');

      return {
        definitionPath,
        serviceTarget: resolveLaunchAgentTarget(serviceName, uid),
      };
    },

    async uninstall({ serviceName }) {
      const definitionPath = resolveLaunchAgentPlistPath(serviceName, homeDir);
      const serviceTarget = resolveLaunchAgentTarget(serviceName, uid);
      const status = await this.status({ serviceName });

      if (status.loaded) {
        await execute('launchctl', ['bootout', serviceTarget], { allowFailure: true });
      }

      await fs.rm(definitionPath, { force: true });

      return {
        definitionPath,
        serviceTarget,
      };
    },

    async start({ serviceName }) {
      const definitionPath = resolveLaunchAgentPlistPath(serviceName, homeDir);
      const serviceTarget = resolveLaunchAgentTarget(serviceName, uid);
      const status = await this.status({ serviceName });

      if (!status.installed) {
        throw new Error('service_not_installed');
      }
      if (status.loaded) {
        return { serviceTarget, changed: false };
      }

      await execute('launchctl', ['bootstrap', resolveLaunchDomain(uid), definitionPath]);
      return { serviceTarget, changed: true };
    },

    async stop({ serviceName }) {
      const serviceTarget = resolveLaunchAgentTarget(serviceName, uid);
      const status = await this.status({ serviceName });

      if (!status.loaded) {
        return { serviceTarget, changed: false };
      }

      await execute('launchctl', ['bootout', serviceTarget], { allowFailure: true });
      return { serviceTarget, changed: true };
    },

    async restart({ serviceName }) {
      const definitionPath = resolveLaunchAgentPlistPath(serviceName, homeDir);
      const serviceTarget = resolveLaunchAgentTarget(serviceName, uid);
      const status = await this.status({ serviceName });

      if (!status.installed) {
        throw new Error('service_not_installed');
      }

      if (!status.loaded) {
        await execute('launchctl', ['bootstrap', resolveLaunchDomain(uid), definitionPath]);
        return { serviceTarget, changed: true };
      }

      await execute('launchctl', ['kickstart', '-k', serviceTarget]);
      return { serviceTarget, changed: true };
    },

    async status({ serviceName }) {
      const definitionPath = resolveLaunchAgentPlistPath(serviceName, homeDir);
      const serviceTarget = resolveLaunchAgentTarget(serviceName, uid);
      const installed = await pathExists(definitionPath);
      const result = installed
        ? await execute('launchctl', ['print', serviceTarget], { allowFailure: true })
        : { code: 1, stdout: '', stderr: '' };
      const loaded = installed && result.code === 0;

      return {
        installed,
        loaded,
        active: loaded,
        enabled: installed,
        definitionPath,
        serviceTarget,
      };
    },
  };
}

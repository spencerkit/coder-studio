import { spawn, ChildProcess } from 'node:child_process';

export interface ServerProcess {
  child: ChildProcess;
  pid: number;
}

export function startServer(
  command = 'pnpm',
  args: string[] = ['dev'],
  cwd?: string
): ServerProcess {
  const child: ChildProcess = spawn(command, args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'test' },
  });

  return {
    child,
    pid: child.pid ?? -1,
  };
}

export function stopServer(server: ServerProcess): void {
  server.child.kill('SIGTERM');
}

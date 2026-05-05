import { ChildProcess, spawn } from "node:child_process";

export interface ServerProcess {
  child: ChildProcess;
  pid: number;
}

export class ServerStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerStartError";
  }
}

export function startServer(
  command = "pnpm",
  args: string[] = ["dev"],
  cwd?: string
): ServerProcess {
  const child: ChildProcess = spawn(command, args, {
    cwd,
    stdio: "pipe",
    env: { ...process.env, NODE_ENV: "test" },
  });

  if (child.pid === undefined) {
    throw new ServerStartError(`Failed to start server process: ${command} ${args.join(" ")}`);
  }

  // Handle spawn errors
  child.on("error", (error) => {
    console.error(`Server process error: ${error.message}`);
  });

  return {
    child,
    pid: child.pid,
  };
}

export function stopServer(server: ServerProcess): void {
  server.child.kill("SIGTERM");
}

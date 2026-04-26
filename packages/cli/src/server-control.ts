import {
  deleteRuntimeConfig,
  readRuntimeConfig,
} from '../../server/src/hooks/runtime-json.js';

export async function stopRunningServer(): Promise<boolean> {
  const runtime = readRuntimeConfig();
  if (!runtime) {
    return false;
  }

  try {
    process.kill(runtime.pid, 'SIGTERM');
    return true;
  } catch (error) {
    const errno = error as NodeJS.ErrnoException;
    if (errno.code === 'ESRCH') {
      deleteRuntimeConfig();
      return false;
    }
    throw error;
  }
}

export async function ensureSingleServer(
  stop = () => stopRunningServer()
): Promise<void> {
  await stop();
}

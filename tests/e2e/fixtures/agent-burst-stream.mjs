import fs from 'node:fs';

const argv = process.argv.slice(2);

const findArgValue = (flag) => {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
};

const chunkCount = Number(findArgValue('--chunks') || process.env.CODER_STUDIO_TEST_BURST_CHUNKS || 24);
const intervalMs = Number(findArgValue('--interval-ms') || process.env.CODER_STUDIO_TEST_BURST_INTERVAL_MS || 2);
const prefix = findArgValue('--prefix') || process.env.CODER_STUDIO_TEST_BURST_PREFIX || 'burst';

const totalChunks = Number.isFinite(chunkCount) && chunkCount > 0 ? Math.floor(chunkCount) : 24;
const writeIntervalMs = Number.isFinite(intervalMs) && intervalMs >= 0 ? intervalMs : 2;
// Windows CI can lose the trailing PTY output if the process exits immediately
// after the last synchronous write, so keep the helper alive a bit longer.
const finalDrainDelayMs = Math.max(writeIntervalMs * 32, 2000);

let index = 0;
const writeNext = () => {
  if (index >= totalChunks) {
    setTimeout(() => {
      process.exitCode = 0;
    }, finalDrainDelayMs);
    return;
  }

  fs.writeSync(process.stdout.fd, `${prefix}-${String(index).padStart(2, '0')}\n`);
  index += 1;
  setTimeout(writeNext, writeIntervalMs);
};

writeNext();

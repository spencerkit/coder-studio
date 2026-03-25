process.stdin.setEncoding('utf8');

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const newlineIndex = buffer.search(/[\r\n]/u);
  if (newlineIndex === -1) {
    return;
  }

  const line = buffer.slice(0, newlineIndex);
  process.stdout.write(`${line}\n`);
  process.exit(0);
});

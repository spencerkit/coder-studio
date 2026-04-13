const SGR_TOKEN_PREFIX = "@@ANSI_SGR_";

export const sanitizeAnsiStream = (value: string) => {
  if (!value) return value;
  const sgrSequences: string[] = [];
  const protectedValue = value.replace(/\x1b\[[0-9;:]*m/g, (match) => {
    const token = `${SGR_TOKEN_PREFIX}${sgrSequences.length}@@`;
    sgrSequences.push(match);
    return token;
  });

  const sanitized = protectedValue
    .replace(/\x1b\][^\u0007]*(\u0007|\x1b\\)/g, "")
    .replace(/\x1b\[(?![0-9;:]*m)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b(?!\[)/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r/g, "");

  return sgrSequences.reduce(
    (result, sequence, index) => result.replace(`${SGR_TOKEN_PREFIX}${index}@@`, sequence),
    sanitized,
  );
};

export const stripAnsi = (value: string) => {
  if (!value) return value;
  return sanitizeAnsiStream(value).replace(/\x1b\[[0-9;:]*m/g, "");
};

export const stripTerminalInputEscapes = (value: string) => value
  .replace(/\x1b\][^\u0007]*(\u0007|\x1b\\)/g, "")
  .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
  .replace(/\x1b./g, "");

export function windowsWslPathToLinux(windowsPath: string, expectedDistro: string): string {
  const normalized = windowsPath.replaceAll("/", "\\");
  const match = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)(?:\\(.*))?$/i.exec(normalized);
  if (!match) {
    throw new Error("Select a folder inside the active WSL distribution");
  }

  const distro = match[1];
  if (!distro) throw new Error("The selected WSL path has no distribution name");
  if (distro.localeCompare(expectedDistro, undefined, { sensitivity: "accent" }) !== 0) {
    throw new Error(`Select a folder inside WSL: ${expectedDistro}`);
  }

  const relativePath = match[2]?.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "") ?? "";
  return relativePath ? `/${relativePath}` : "/";
}

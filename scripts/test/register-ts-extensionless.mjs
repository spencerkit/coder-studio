import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

function isRelativeOrAbsoluteFileSpecifier(specifier) {
  return specifier.startsWith('./')
    || specifier.startsWith('../')
    || specifier.startsWith('/')
    || specifier.startsWith('file:');
}

function hasExplicitExtension(specifier) {
  const candidate = specifier.startsWith('file:')
    ? fileURLToPath(specifier)
    : specifier;
  return /\.(?:[cm]?[jt]sx?|json|node)$/i.test(candidate);
}

function resolveCandidatePaths(specifier, parentURL) {
  const resolvedUrl = new URL(
    specifier,
    parentURL ?? pathToFileURL(`${process.cwd()}${path.sep}`).href,
  );
  const basePath = fileURLToPath(resolvedUrl);
  return [
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
  ];
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!isRelativeOrAbsoluteFileSpecifier(specifier) || hasExplicitExtension(specifier)) {
        throw error;
      }

      for (const candidatePath of resolveCandidatePaths(specifier, context.parentURL)) {
        if (!fs.existsSync(candidatePath)) {
          continue;
        }
        return nextResolve(pathToFileURL(candidatePath).href, context);
      }

      throw error;
    }
  },
});

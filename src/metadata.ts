import { readFileSync } from 'node:fs';

// Both src/ and dist/ are one level below package.json. No copied version string.
const metadata: unknown = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
if (
  typeof metadata !== 'object' || metadata === null ||
  !('name' in metadata) || typeof metadata.name !== 'string' || !metadata.name ||
  !('version' in metadata) || typeof metadata.version !== 'string' || !metadata.version ||
  !('displayName' in metadata) || typeof metadata.displayName !== 'string' || !metadata.displayName
) {
  throw new Error('package.json must define name, version and displayName');
}

export const serverInfo = Object.freeze({
  name: metadata.name,
  version: metadata.version,
  title: metadata.displayName,
});

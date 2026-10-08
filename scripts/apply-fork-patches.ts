/** Regenerate the fork integration files from the recorded upstream baseline during development. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readUpstreamState } from './upstream/repository';
import { generateSourcePatches } from './upstream/source-patches';

/** Generate all files before writing, so a broken contract cannot leave a half-applied patch. */
async function applyForkPatches(): Promise<void> {
  const repository = process.cwd();
  const { upstreamCommit } = readUpstreamState(repository);
  const sources = await generateSourcePatches(repository, upstreamCommit);
  for (const [path, source] of sources) writeFileSync(resolve(repository, path), source);
}

if (import.meta.main) await applyForkPatches();

import { IndentationText, Project, QuoteKind } from 'ts-morph';
import path from 'node:path';
import type { Codemod, Match } from '../types.js';

/**
 * Loads the target repo's JS/TS source into a ts-morph Project.
 *
 * Scans the whole repo tree (not just `src/**`) — plenty of real-world repos
 * (e.g. Express apps with `controllers/`) have no `src/` at all. One fixed
 * glob, no CLI flag and no `apidrift.json` field for this: keeping the
 * matcher's reach un-configurable is deliberate, it's blast-radius control,
 * not a missing feature. The exclusions below are mandatory and cover the
 * usual build/vendor/test noise so we don't match generated code or fixtures.
 */
export function loadProject(workspaceDir: string): Project {
  const project = new Project({
    compilerOptions: { allowJs: true },
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: false,
    manipulationSettings: {
      indentationText: IndentationText.TwoSpaces,
      quoteKind: QuoteKind.Single,
    },
  });

  project.addSourceFilesAtPaths([
    path.join(workspaceDir, '**/*.{js,ts,jsx,tsx}'),
    `!${path.join(workspaceDir, '**/node_modules/**')}`,
    `!${path.join(workspaceDir, '**/dist/**')}`,
    `!${path.join(workspaceDir, '**/build/**')}`,
    `!${path.join(workspaceDir, '**/out/**')}`,
    `!${path.join(workspaceDir, '**/coverage/**')}`,
    `!${path.join(workspaceDir, '**/.next/**')}`,
    `!${path.join(workspaceDir, '**/vendor/**')}`,
    `!${path.join(workspaceDir, '**/examples/**')}`,
    `!${path.join(workspaceDir, '**/*.d.ts')}`,
    `!${path.join(workspaceDir, '**/*.test.*')}`,
    `!${path.join(workspaceDir, '**/*.spec.*')}`,
    `!${path.join(workspaceDir, '**/test/**')}`,
    `!${path.join(workspaceDir, '**/tests/**')}`,
    `!${path.join(workspaceDir, '**/__tests__/**')}`,
  ]);

  return project;
}

/** Find all usages of a codemod's target across the project. */
export function findMatches(project: Project, codemod: Codemod): Match[] {
  return codemod.find(project);
}

import { IndentationText, Project, QuoteKind } from 'ts-morph';
import path from 'node:path';
import type { Codemod, Match } from '../types.js';

/**
 * Loads the target repo's JS/TS source into a ts-morph Project.
 * We scan `src/**` by default and skip node_modules and tests.
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
    path.join(workspaceDir, 'src/**/*.{js,ts,jsx,tsx}'),
    `!${path.join(workspaceDir, '**/node_modules/**')}`,
    `!${path.join(workspaceDir, '**/*.test.*')}`,
    `!${path.join(workspaceDir, '**/test/**')}`,
  ]);

  return project;
}

/** Find all usages of a codemod's target across the project. */
export function findMatches(project: Project, codemod: Codemod): Match[] {
  return codemod.find(project);
}

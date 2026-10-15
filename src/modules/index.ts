import type { ToolModule } from '../core/module.js';
import { browserModule } from './browser/index.js';
import { screenshotModule } from './screenshot/index.js';
import { shellModule } from './shell/index.js';

export { browserModule, screenshotModule, shellModule };

/** Explicit, reviewable manifest: add new feature modules here, not in the CLI. */
export const builtinModules: readonly ToolModule[] = Object.freeze([
  screenshotModule,
  browserModule,
  shellModule,
]);

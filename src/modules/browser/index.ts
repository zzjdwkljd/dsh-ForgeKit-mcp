import type { ToolModule } from '../../core/module.js';
import { closeBrowser } from '../../browser.js';
import { registerSessionTools } from './session.js';
import { registerNavigationTools } from './navigation.js';
import { registerInteractionTools } from './interaction.js';
import { registerContentTools } from './content.js';
import { registerStateTools } from './state.js';
import { registerDiagnosticsTools } from './diagnostics.js';
import { registerClockTools } from './clock.js';

export const browserModule: ToolModule = {
  id: 'browser',
  description: 'Local Chrome/Edge automation, page interaction, diagnostics and session state.',
  register(server) {
    registerSessionTools(server);
    registerNavigationTools(server);
    registerInteractionTools(server);
    registerContentTools(server);
    registerStateTools(server);
    registerDiagnosticsTools(server);
    registerClockTools(server);
  },
  async dispose() {
    await closeBrowser();
  },
};

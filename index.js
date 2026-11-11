// -----------------------------------------------------------------------------
// Entry point: wires the SDK handlers to the integration (src/app.js), which
// holds everything else. The supervisor of Gladys gives the container its
// environment (GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN,
// GLADYS_INTEGRATION_SELECTOR); `new GladysIntegration()` reads it.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { App } from './src/app.js';
import { registerHandlers } from './src/handlers.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
const app = new App({ gladys, version });
registerHandlers(gladys, app);

// A promise that slips through one day must not kill the container: log it,
// the next read goes on.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal}: stopping`);
  await app.stop();
});

logger.info(`Starting gladys-ukraine-alarm ${version}`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});

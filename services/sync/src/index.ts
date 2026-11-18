import process from 'node:process';
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createAppServer } from './server.js';

const config = loadConfig();
const app = await createAppServer(config);
const server = createServer((req, res) => void app.handler(req, res));
server.listen(config.port, () => console.log(`@mail sync ouvindo em http://localhost:${config.port}`));
async function shutdown(): Promise<void> { server.close(); await app.close(); }
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

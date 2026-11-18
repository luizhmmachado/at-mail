import process from 'node:process';
import { createServer } from 'node:http';
import { loadConfig } from './config';
import { createAppServer } from './server';

const config = loadConfig();
const app = createAppServer(config);
const server = createServer((req, res) => void app.handler(req, res));
server.listen(config.port, () => console.log(`@mail sync ouvindo em http://localhost:${config.port}`));
function shutdown(): void { server.close(); app.close(); }
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

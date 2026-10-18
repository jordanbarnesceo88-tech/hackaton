import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] || 3071);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be an integer from 1024 to 65535');
const artifact = fileURLToPath(new URL('../../public/warehouse-3d.html', import.meta.url));
const cleaningArtifact = fileURLToPath(new URL('../../public/cleaning-3d.html', import.meta.url));
createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const route = url.pathname;
  if (route === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  const redirect = { '/': '/demo/warehouse', '/warehouse-3d.html': '/demo/warehouse', '/cleaning-3d.html': '/demo/cleaning' }[route];
  if (redirect) { res.writeHead(308, { Location: redirect + url.search }); res.end(); return; }
  if (route !== '/demo/warehouse' && route !== '/demo/cleaning') { res.writeHead(404); res.end('Not found'); return; }
  try {
    const html = await readFile(route === '/demo/cleaning' ? cleaningArtifact : artifact);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Build the demo first: node experiments/warehouse-3d/build.mjs');
  }
}).listen(port, '127.0.0.1', () => console.log(`Warehouse 3D: http://127.0.0.1:${port}/demo/warehouse`));

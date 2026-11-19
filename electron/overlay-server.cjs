const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function createOverlayServer(options = {}) {
  const token = options.token || crypto.randomBytes(24).toString('hex');
  const assets = path.join(__dirname, '..', 'src');
  const clients = new Set();
  let current = { typed: '', syllables: [], cursor: false, visible: true, settings: {} };
  const files = {
    '/': ['overlay.html', 'text/html; charset=utf-8'],
    '/overlay.css': ['overlay.css', 'text/css; charset=utf-8'],
    '/overlay.js': ['overlay.js', 'text/javascript; charset=utf-8']
  };
  const server = http.createServer((req, res) => {
    const pathname = req.url.split('?', 1)[0];
    const prefix = `/overlay/${token}`;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ||
        req.method !== 'GET' || !pathname.startsWith(prefix + '/')) {
      res.writeHead(404).end();
      return;
    }
    const route = pathname.slice(prefix.length);
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'"
    };
    if (route === '/events') {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
      res.write(`retry: 1000\ndata: ${JSON.stringify(current)}\n\n`);
      clients.add(res);
      res.on('close', () => clients.delete(res));
      return;
    }
    const asset = files[route];
    if (!asset) { res.writeHead(404).end(); return; }
    try {
      const body = fs.readFileSync(path.join(assets, asset[0]));
      res.writeHead(200, { ...headers, 'Content-Type': asset[1] });
      res.end(body);
    } catch {
      res.writeHead(500).end();
    }
  });
  return {
    async start() {
      const listen = (port) => new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      try {
        const port = options.port;
        await listen(Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0);
      } catch (error) {
        if (error.code !== 'EADDRINUSE') throw error;
        await listen(0);
      }
      return `http://127.0.0.1:${server.address().port}/overlay/${token}/`;
    },
    publish(patch) {
      current = { ...current, ...patch };
      const payload = `data: ${JSON.stringify(current)}\n\n`;
      for (const client of clients) {
        if (!client.write(payload)) client.destroy();
      }
    },
    close() {
      for (const client of clients) client.end();
      clients.clear();
      server.close();
    }
  };
}

module.exports = { createOverlayServer };

const http = require('node:http');
const crypto = require('node:crypto');

function createNativeBridge(handlers) {
  const token = crypto.randomBytes(32).toString('hex');
  const clients = new Set();
  const server = http.createServer(async (request, response) => {
    const authorized = request.headers.authorization === `Bearer ${token}`;
    if (!authorized || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'GET' && request.url === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
      response.write('data: {"type":"connected"}\n\n');
      clients.add(response);
      response.on('close', () => clients.delete(response));
      return;
    }
    if (request.method !== 'POST' || request.url !== '/rpc') {
      response.writeHead(404).end();
      return;
    }
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 256000) throw new Error('Request too large');
      }
      const { method, args = [] } = JSON.parse(body);
      if (!Object.hasOwn(handlers, method) || !Array.isArray(args)) throw new Error('Unknown method');
      const result = await handlers[method](...args);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(result ?? null));
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ ok: false, message: error.message }));
    }
  });
  return {
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      return { url: `http://127.0.0.1:${server.address().port}`, token };
    },
    publish(type, data) {
      const message = `data: ${JSON.stringify({ type, data })}\n\n`;
      for (const client of clients) if (!client.write(message)) client.destroy();
    },
    close() {
      for (const client of clients) client.end();
      clients.clear();
      server.close();
    }
  };
}

module.exports = { createNativeBridge };

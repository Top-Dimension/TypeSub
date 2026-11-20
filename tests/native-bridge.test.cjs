const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeBridge } = require('../electron/native-bridge.cjs');

test('native bridge limits access to its token and carries events and RPC', async () => {
  const bridge = createNativeBridge({ echo: (value) => ({ value }) });
  const { url, token } = await bridge.start();
  try {
    const denied = await fetch(`${url}/rpc`, {
      method: 'POST', body: JSON.stringify({ method: 'echo', args: ['private'] })
    });
    assert.equal(denied.status, 404);

    const rpc = await fetch(`${url}/rpc`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ method: 'echo', args: ['caption'] })
    });
    assert.deepEqual(await rpc.json(), { value: 'caption' });

    const events = await fetch(`${url}/events`, { headers: { Authorization: `Bearer ${token}` } });
    const reader = events.body.getReader();
    const decoder = new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value), /"type":"connected"/);
    bridge.publish('speech', { status: 'listening' });
    assert.match(decoder.decode((await reader.read()).value), /"status":"listening"/);
    await reader.cancel();
  } finally {
    bridge.close();
  }
});

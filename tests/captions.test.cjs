const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createCaptionPipeline } = require('../electron/caption-pipeline.cjs');
const { createOverlayServer } = require('../electron/overlay-server.cjs');
const { improveCaption } = require('../electron/ai-caption.cjs');

test('ASR is displayed immediately and an old AI correction cannot replace new speech', async () => {
  const commands = [];
  const pending = [];
  const captions = createCaptionPipeline({
    command: (...args) => { commands.push(args); return true; },
    aiConfig: () => ({ apiKey: 'test', model: 'test' }),
    onAiError: assert.fail,
    improve: (_text, _config, { signal }) => new Promise((resolve) => pending.push({ signal, resolve }))
  });

  captions.submit('原始字幕', { optimize: true });
  assert.deepEqual(commands, [['start', '原始字幕']]);
  captions.submit('下一段');
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve('已過時的校正');
  await new Promise(setImmediate);
  assert.deepEqual(commands.at(-1), ['start', '下一段']);

  captions.submit('下一段說完了', { revise: true, optimize: true });
  pending[1].resolve('下一段說完了。');
  await new Promise(setImmediate);
  assert.deepEqual(commands.slice(-2), [['partial', '下一段說完了'], ['partial', '下一段說完了。']]);
});

test('skips the API when optional settings are empty and rejects truncated answers', async () => {
  const text = '原始字幕';
  assert.equal(await improveCaption(text, {}, { fetch: assert.fail }), text);
  const fetch = async (url, options) => {
    assert.equal(url.href, 'http://127.0.0.1:1234/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.messages[1].content, text);
    assert.equal(body.reasoning_effort, undefined);
    return Response.json({ choices: [{ finish_reason: 'length', message: { content: '原始' } }] });
  };
  assert.equal(await improveCaption(text, {
    baseUrl: 'http://127.0.0.1:1234/v1/chat/completions', apiKey: 'test', model: 'model'
  }, { fetch }), text);
});

test('AI timeout keeps the raw caption and releases the request', async () => {
  const commands = [];
  await new Promise((resolve) => {
    const captions = createCaptionPipeline({
      command: (...args) => { commands.push(args); return true; },
      aiConfig: () => ({ apiKey: 'test', model: 'test' }),
      onAiError: resolve,
      improve: (text, config, options) => improveCaption(text, config, {
        ...options, timeoutMs: 20,
        fetch: (_url, { signal }) => new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })
      })
    });
    captions.submit('原始字幕', { optimize: true });
  });
  assert.deepEqual(commands, [['start', '原始字幕']]);
});

test('OBS reconnect gets the latest frame and receives updates on the private URL', async () => {
  const overlay = createOverlayServer();
  const url = await overlay.start();
  let reader;
  try {
    assert.equal((await fetch(new URL('/', url))).status, 404);
    assert.equal((await fetch(url)).status, 200);
    overlay.publish({ typed: '舊字幕' });
    const response = await fetch(new URL('events', url));
    reader = response.body.getReader();
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const decoder = new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value), /舊字幕/);
    overlay.publish({ typed: '即時字幕', visible: false });
    assert.match(decoder.decode((await reader.read()).value), /"typed":"即時字幕".*"visible":false/);
  } finally {
    await reader?.cancel();
    overlay.close();
  }
});

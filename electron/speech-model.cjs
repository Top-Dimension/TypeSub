const { createHash } = require('node:crypto');
const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const MODEL = {
  id: 'sherpa-onnx-x-asr-160ms-streaming-zipformer-transducer-zh-en-punct-int8-2026-06-05',
  name: '中文（普通话） / English',
  bytes: 133898007,
  sha256: '8a6fca056e1a342546edd78be4d50274e2c01898e7b8ae8fc336f6410319c399'
};
const FILES = ['encoder.int8.onnx', 'decoder.onnx', 'joiner.int8.onnx', 'tokens.txt'];
const RELEASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/';

function createSpeechModel(root, fetch = globalThis.fetch, bundledRoot) {
  const directory = path.join(bundledRoot || root, MODEL.id);
  let controller;
  let job;
  let progress = null;

  async function installed() {
    try {
      const files = await Promise.all(FILES.map((name) => fs.stat(path.join(directory, name))));
      return files.every((file) => file.isFile() && file.size > 0);
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  async function download(onProgress) {
    if (await installed()) return;
    if (bundledRoot) throw new Error('The bundled speech model is missing. Reinstall TypeSub to restore it.');
    if (job) return job;
    controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60 * 1000)]);
    const report = (update) => {
      progress = update;
      onProgress(progress);
    };
    job = (async () => {
      await fs.mkdir(root, { recursive: true });
      const staging = await fs.mkdtemp(path.join(root, '.download-'));
      try {
        const archive = path.join(staging, 'model.tar.bz2');
        const unpacked = path.join(staging, 'files');
        await fs.mkdir(unpacked);
        report({ phase: 'downloading', percent: 0 });
        const response = await fetch(RELEASE + MODEL.id + '.tar.bz2', { signal, cache: 'no-store' });
        if (!response.ok || !response.body) throw new Error(`模型下载失败（HTTP ${response.status}）。`);
        const hash = createHash('sha256');
        let bytes = 0;
        const meter = new Transform({
          transform(chunk, _encoding, next) {
            bytes += chunk.length;
            if (bytes > MODEL.bytes) return next(new Error('模型下载大小不符。'));
            hash.update(chunk);
            const percent = Math.floor(bytes * 100 / MODEL.bytes);
            if (progress?.percent !== percent) report({ phase: 'downloading', percent });
            next(null, chunk);
          }
        });
        await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(archive), { signal });
        if (bytes !== MODEL.bytes || hash.digest('hex') !== MODEL.sha256) throw new Error('模型校验失败，请重新下载。');
        report({ phase: 'extracting', percent: 100 });
        await promisify(execFile)('tar', [
          '-xf', archive, '-C', unpacked, '--strip-components', '1',
          ...FILES.map((name) => MODEL.id + '/' + name)
        ], { signal, windowsHide: true });
        signal.throwIfAborted();
        if (await installed()) return;
        await fs.rm(directory, { recursive: true, force: true });
        await fs.rename(unpacked, directory);
      } finally {
        await fs.rm(staging, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
      }
    })().finally(() => {
      controller = undefined;
      job = undefined;
      progress = null;
    });
    return job;
  }

  return {
    directory,
    installed,
    download,
    cancel() {
      controller?.abort();
      return job;
    },
    status: async () => ({ name: MODEL.name, bytes: MODEL.bytes, installed: await installed(), progress })
  };
}

module.exports = { createSpeechModel, MODEL, FILES, RELEASE };

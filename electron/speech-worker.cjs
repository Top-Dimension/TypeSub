const path = require('node:path');

function createRecognizer(directory, report) {
  const { OnlineRecognizer } = require('sherpa-onnx-node/streaming-asr.js');
  const file = (name) => path.join(directory, name);
  const recognizer = new OnlineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: file('encoder.int8.onnx'), decoder: file('decoder.onnx'), joiner: file('joiner.int8.onnx') },
      tokens: file('tokens.txt'),
      numThreads: 2,
      provider: 'cpu'
    },
    decodingMethod: 'greedy_search',
    enableEndpoint: 1,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: .65,
    rule3MinUtteranceLength: 20
  });
  const stream = recognizer.createStream();
  let previous = '';

  return (samples, sampleRate) => {
    stream.acceptWaveform({ samples, sampleRate });
    while (recognizer.isReady(stream)) recognizer.decode(stream);
    const text = recognizer.getResult(stream).text.trim();
    if (recognizer.isEndpoint(stream)) {
      if (text) report({ type: 'final', text });
      else if (previous) report({ type: 'rejected' });
      recognizer.reset(stream);
      previous = '';
    } else if (text && text !== previous) {
      report({ type: 'partial', text });
      previous = text;
    }
  };
}

if (process.parentPort) {
  const accept = createRecognizer(process.argv[2], (event) => process.parentPort.postMessage(event));
  process.parentPort.on('message', ({ data }) => {
    accept(data.samples, data.sampleRate);
    process.parentPort.postMessage({ type: 'drain' });
  });
  process.parentPort.postMessage({ type: 'ready' });
} else if (process.send) {
  const accept = createRecognizer(process.argv[2], (event) => process.send(event));
  process.on('message', ({ samples, sampleRate }) => {
    accept(samples, sampleRate);
    process.send({ type: 'drain' });
  });
  process.send({ type: 'ready' });
}

module.exports = { createRecognizer };

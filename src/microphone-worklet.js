class TypeSubMicrophone extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    this.size = processorOptions.chunkSize;
    this.chunk = new Float32Array(this.size);
    this.offset = 0;
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (let index = 0; index < samples.length; index++) {
      this.chunk[this.offset++] = samples[index];
      if (this.offset === this.size) {
        this.port.postMessage(this.chunk, [this.chunk.buffer]);
        this.chunk = new Float32Array(this.size);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('typesub-microphone', TypeSubMicrophone);

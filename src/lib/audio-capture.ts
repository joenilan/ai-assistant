export interface RecordedAudio {
  wavBytes: Uint8Array;
  durationMs: number;
  sampleRate: number;
}

export interface ActiveAudioCapture {
  stop: () => Promise<RecordedAudio>;
  cancel: () => Promise<void>;
}

type AudioContextConstructor = typeof AudioContext;

function getAudioContextConstructor(): AudioContextConstructor {
  const ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;

  if (!ctor) {
    throw new Error("This runtime does not expose the Web Audio API needed for microphone capture.");
  }

  return ctor;
}

function mergeBuffers(chunks: Float32Array[], totalLength: number) {
  const result = new Float32Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

function encodeWav(samples: Float32Array, sampleRate: number) {
  const bytesPerSample = 2;
  const channelCount = 1;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  function writeString(offset: number, value: string) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

export async function startAudioCapture(): Promise<ActiveAudioCapture> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone capture is not available in this runtime.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const AudioContextClass = getAudioContextConstructor();
  const audioContext = new AudioContextClass();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const silentGain = audioContext.createGain();
  const chunks: Float32Array[] = [];
  let totalLength = 0;
  let stopped = false;

  silentGain.gain.value = 0;

  processor.onaudioprocess = (event) => {
    const channelData = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(channelData.length);
    copy.set(channelData);
    chunks.push(copy);
    totalLength += copy.length;
  };

  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(audioContext.destination);

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  async function teardown() {
    if (stopped) {
      return;
    }

    stopped = true;
    processor.disconnect();
    silentGain.disconnect();
    source.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    await audioContext.close();
  }

  return {
    async stop() {
      await teardown();

      if (!totalLength) {
        throw new Error("No microphone audio was captured.");
      }

      const merged = mergeBuffers(chunks, totalLength);
      return {
        wavBytes: encodeWav(merged, audioContext.sampleRate),
        durationMs: Math.round((merged.length / audioContext.sampleRate) * 1000),
        sampleRate: audioContext.sampleRate,
      };
    },
    async cancel() {
      await teardown();
    },
  };
}

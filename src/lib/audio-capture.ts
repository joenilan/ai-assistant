export interface RecordedAudio {
  wavBytes: Uint8Array;
  durationMs: number;
  sampleRate: number;
}

export interface ActiveAudioCapture {
  stop: () => Promise<RecordedAudio>;
  cancel: () => Promise<void>;
}

export interface OpenMicSegment {
  recording: RecordedAudio;
}

export interface OpenMicMonitorOptions {
  onSegment: (segment: OpenMicSegment) => void | Promise<void>;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
  speechThreshold?: number;
  minSpeechMs?: number;
  silenceMs?: number;
  maxSpeechMs?: number;
  preRollMs?: number;
}

export interface ActiveOpenMicMonitor {
  setPaused: (paused: boolean) => void;
  stop: () => Promise<void>;
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

function bufferDurationMs(sampleCount: number, sampleRate: number) {
  return (sampleCount / sampleRate) * 1000;
}

function calculateRms(samples: Float32Array) {
  let total = 0;

  for (let index = 0; index < samples.length; index += 1) {
    total += samples[index] * samples[index];
  }

  return Math.sqrt(total / samples.length);
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

export async function startOpenMicMonitor(
  options: OpenMicMonitorOptions,
): Promise<ActiveOpenMicMonitor> {
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
  const speechThreshold = options.speechThreshold ?? 0.02;
  const minSpeechMs = options.minSpeechMs ?? 500;
  const silenceMs = options.silenceMs ?? 900;
  const maxSpeechMs = options.maxSpeechMs ?? 15000;
  const preRollMs = options.preRollMs ?? 250;
  const preRollChunks: Float32Array[] = [];
  let preRollDurationMs = 0;
  let utteranceChunks: Float32Array[] = [];
  let utteranceLength = 0;
  let utteranceDurationMs = 0;
  let trailingSilenceMs = 0;
  let speaking = false;
  let paused = false;
  let stopped = false;

  silentGain.gain.value = 0;

  function resetUtterance() {
    utteranceChunks = [];
    utteranceLength = 0;
    utteranceDurationMs = 0;
    trailingSilenceMs = 0;
    speaking = false;
  }

  function pushToPreRoll(chunk: Float32Array, durationMs: number) {
    preRollChunks.push(chunk);
    preRollDurationMs += durationMs;

    while (preRollChunks.length && preRollDurationMs > preRollMs) {
      const removed = preRollChunks.shift();
      if (removed) {
        preRollDurationMs -= bufferDurationMs(removed.length, audioContext.sampleRate);
      }
    }
  }

  function finalizeUtterance() {
    const effectiveSpeechMs = utteranceDurationMs - trailingSilenceMs;
    const finalizedChunks = utteranceChunks;
    const finalizedLength = utteranceLength;
    resetUtterance();

    if (!finalizedLength || effectiveSpeechMs < minSpeechMs) {
      return;
    }

    options.onSpeechEnd?.();

    const merged = mergeBuffers(finalizedChunks, finalizedLength);
    const recording: RecordedAudio = {
      wavBytes: encodeWav(merged, audioContext.sampleRate),
      durationMs: Math.round((merged.length / audioContext.sampleRate) * 1000),
      sampleRate: audioContext.sampleRate,
    };

    void Promise.resolve(options.onSegment({ recording })).catch((error) => {
      console.error("Open mic transcription pipeline failed.", error);
    });
  }

  processor.onaudioprocess = (event) => {
    if (stopped) {
      return;
    }

    const channelData = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(channelData.length);
    copy.set(channelData);
    const durationMs = bufferDurationMs(copy.length, audioContext.sampleRate);
    const rms = calculateRms(copy);

    if (paused) {
      if (speaking) {
        resetUtterance();
      }

      preRollChunks.length = 0;
      preRollDurationMs = 0;
      return;
    }

    pushToPreRoll(copy, durationMs);

    if (!speaking) {
      if (rms >= speechThreshold) {
        speaking = true;
        options.onSpeechStart?.();
        utteranceChunks = [...preRollChunks];
        utteranceLength = utteranceChunks.reduce((total, chunk) => total + chunk.length, 0);
        utteranceDurationMs = utteranceChunks.reduce(
          (total, chunk) => total + bufferDurationMs(chunk.length, audioContext.sampleRate),
          0,
        );
        trailingSilenceMs = 0;
        preRollChunks.length = 0;
        preRollDurationMs = 0;
      }
      return;
    }

    utteranceChunks.push(copy);
    utteranceLength += copy.length;
    utteranceDurationMs += durationMs;

    if (rms >= speechThreshold) {
      trailingSilenceMs = 0;
    } else {
      trailingSilenceMs += durationMs;
    }

    if (utteranceDurationMs >= maxSpeechMs || trailingSilenceMs >= silenceMs) {
      finalizeUtterance();
    }
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
    setPaused(nextPaused) {
      paused = nextPaused;

      if (paused && speaking) {
        resetUtterance();
      }
    },
    async stop() {
      await teardown();
    },
  };
}

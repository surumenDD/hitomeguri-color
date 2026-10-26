// Offline export through WebCodecs: every frame is rendered at an exact timestamp and
// encoded, never captured from a live clock. The muxer turns encoded chunks into a file.
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from '../node_modules/mp4-muxer/build/mp4-muxer.mjs';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from '../node_modules/webm-muxer/build/webm-muxer.mjs';

// H.264 High profile, level 5.1: covers 1080p. VP9 level must cover the frame area,
// so 720p gets level 3.1 and 1080p gets level 4.0.
const H264 = { codec: 'avc1.640033', level: '5.1' };
function vp9Codec(width, height) {
  const area = width * height;
  if (area <= 1280 * 720) return 'vp09.00.31.08';
  return 'vp09.00.40.08';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n) => Math.round(n * 10) / 10;

export function videoConfig({ format, width, height, fps, bitrate }) {
  const base = { width, height, bitrate, framerate: fps, latencyMode: 'quality' };
  if (format === 'mp4') return { ...base, codec: H264.codec, avc: { format: 'avc' } };
  if (format === 'webm') return { ...base, codec: vp9Codec(width, height) };
  throw new Error(`unknown format ${format}`);
}

export function makeMuxer({ format, width, height, fps }) {
  if (format === 'mp4') {
    return new Mp4Muxer({
      target: new Mp4Target(),
      video: { codec: 'avc', width, height, frameRate: fps },
      // Keeps the moov atom in front of the media data without buffering the media.
      fastStart: 'in-memory',
      firstTimestampBehavior: 'strict',
    });
  }
  if (format === 'webm') {
    return new WebmMuxer({
      target: new WebmTarget(),
      video: { codec: 'V_VP9', width, height, frameRate: fps },
    });
  }
  throw new Error(`unknown format ${format}`);
}

/**
 * @param scene   the WebGL2 scene
 * @param canvas  the canvas the scene draws into
 * @returns {{ blob: Blob, stats: object }}
 */
export async function exportVideo(scene, canvas, { format, width, height, fps = 30, seconds = 8, bitrate, keyframeSeconds = 1, log = () => {} }) {
  const frames = Math.round(fps * seconds);
  const config = videoConfig({ format, width, height, fps, bitrate });
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) throw new Error(`${format} is not supported here: ${JSON.stringify(config)}`);

  scene.setSize(width, height);
  const muxer = makeMuxer({ format, width, height, fps });

  let encodeError = null;
  let chunks = 0;
  let keyframes = 0;
  let sawDescription = false;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
      chunks++;
      if (chunk.type === 'key') keyframes++;
      if (meta?.decoderConfig?.description) sawDescription = true;
    },
    error: (e) => { encodeError = e; },
  });
  encoder.configure(config);

  const keyEvery = Math.max(1, Math.round(fps * keyframeSeconds));
  let renderMs = 0;
  let captureMs = 0;
  let stallMs = 0;
  let queueMax = 0;
  const tStart = performance.now();

  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    const r0 = performance.now();
    scene.renderAt(t);
    const r1 = performance.now();
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round((i * 1e6) / fps),
      duration: Math.round(1e6 / fps),
    });
    const r2 = performance.now();
    encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
    frame.close();
    renderMs += r1 - r0;
    captureMs += r2 - r1;
    queueMax = Math.max(queueMax, encoder.encodeQueueSize);
    // Backpressure: let the encoder drain instead of piling up VideoFrames.
    if (encoder.encodeQueueSize > 8) {
      const w0 = performance.now();
      await sleep(0);
      stallMs += performance.now() - w0;
    }
    if (i % 60 === 0) log(`  ${format} ${width}x${height} frame ${i}/${frames}`);
  }
  await encoder.flush();
  const tFlush = performance.now();
  if (encodeError) throw encodeError;
  encoder.close();

  const muxStart = performance.now();
  muxer.finalize();
  const muxMs = performance.now() - muxStart;
  const tEnd = performance.now();

  const buffer = muxer.target.buffer;
  const encodeMs = tFlush - tStart - renderMs - captureMs;
  const totalMs = tEnd - tStart;
  return {
    blob: new Blob([buffer], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' }),
    stats: {
      format,
      width,
      height,
      fps,
      seconds,
      frames,
      bitrate,
      codec: config.codec,
      codecLevel: format === 'mp4' ? H264.level : null,
      latencyMode: config.latencyMode,
      keyframeIntervalFrames: keyEvery,
      keyframes,
      chunks,
      decoderConfigDescription: sawDescription,
      encoderQueueMax: queueMax,
      // Times are wall-clock milliseconds measured inside the page.
      renderMs: round(renderMs),
      captureMs: round(captureMs),
      encodeMs: round(encodeMs),
      stallMs: round(stallMs),
      muxMs: round(muxMs),
      totalMs: round(totalMs),
      msPerFrame: round(totalMs / frames),
      encodeFps: round((frames * 1000) / totalMs),
      bytes: buffer.byteLength,
    },
  };
}

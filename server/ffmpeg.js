const { spawn, spawnSync } = require('child_process');
const probeQueue = require('./resource-queue').createQueue({ software: 2, maxQueue: 16, timeoutMs: 15000 });

// Registry of currently-running ffmpeg processes, so a server shutdown
// can kill them all instead of leaving orphaned encoders burning CPU
// after the service itself has stopped/restarted.
const liveProcs = new Set();
function trackLive(proc) {
  liveProcs.add(proc);
  proc.on('close', () => liveProcs.delete(proc));
  proc.on('error', () => liveProcs.delete(proc));
  return proc;
}
function killAllLive() {
  for (const proc of liveProcs) {
    try { proc.kill('SIGKILL'); } catch (e) { /* already gone */ }
  }
  liveProcs.clear();
}
const path = require('path');

function checkBinary(name) {
  try {
    const r = spawnSync(name, ['-version']);
    return !r.error && r.status === 0;
  } catch (e) {
    return false;
  }
}

const HAS_FFMPEG = checkBinary('ffmpeg');
const HAS_FFPROBE = checkBinary('ffprobe');

// Codecs the HTML5 <video> element can decode natively across mainstream
// browsers. Anything outside this set (AC3, DTS, TrueHD, HEVC without
// hardware support, etc.) needs to be transcoded.
const BROWSER_AUDIO_CODECS = new Set(['aac', 'mp3', 'opus', 'vorbis']);
const BROWSER_VIDEO_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
// MP4-family containers (H.264/VP9/AV1 + AAC/MP3 typically) and WebM
// (VP8/VP9/AV1 + Opus/Vorbis - WebM is AV1's most common container) are
// both natively playable by every modern browser without any remuxing.
const NATIVE_CONTAINER_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.webm']);

// Concurrent consumers share one inspection, including across subtitle and
// playback routes. Only in-flight work is shared; later calls see file changes.
const pendingProbes = new Map();
function probe(filePath) {
  if (pendingProbes.has(filePath)) return pendingProbes.get(filePath);
  const job = runProbe(filePath).finally(() => pendingProbes.delete(filePath));
  pendingProbes.set(filePath, job);
  return job;
}
async function runProbe(filePath) {
  const release = await probeQueue.acquireSlot();
  return new Promise((resolve, reject) => {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', '-show_chapters', filePath];
    let proc;
    try { proc = trackLive(spawn('ffprobe', args, { windowsHide: true })); } catch (error) { release(); reject(error); return; }
    proc.once('close', release); proc.once('error', release);
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Media probe timed out')); }, 20000);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d; if (out.length > 8 * 1024 * 1024) { proc.kill(); reject(new Error('Media probe output is too large')); } });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err || `ffprobe exited with code ${code}`));
      try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
    });
    proc.on('error', error => { clearTimeout(timer); reject(error); });
  });
}

// Image-based (bitmap) subtitle formats - PGS from Blu-rays, DVD
// subtitles, DVB teletext-style subs. These are literally pictures of
// text, not text data, so ffmpeg's text-based webvtt extraction can't
// convert them at all (that would need OCR, which it doesn't do) -
// silently producing an empty result rather than an error. Very common
// on BD-sourced releases that bundle an official PGS English track
// alongside a text-based (ASS/SRT) fan-translated track for the rest.
const IMAGE_SUBTITLE_CODECS = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvdsub', 'dvb_subtitle', 'dvb_teletext', 'pgssub', 'xsub']);

function trackLabel(stream, kindLetter, idx) {
  const lang = (stream.tags && (stream.tags.language || stream.tags.LANGUAGE)) || 'und';
  const title = (stream.tags && (stream.tags.title || stream.tags.TITLE)) || null;
  return {
    index: stream.index,
    order: idx,
    language: lang,
    title,
    codec: stream.codec_name,
    imageBased: IMAGE_SUBTITLE_CODECS.has(stream.codec_name),
    channels: stream.channels || null,
    default: !!(stream.disposition && stream.disposition.default),
    forced: !!(stream.disposition && stream.disposition.forced),
  };
}

function analyzeStreams(probeData, filePath) {
  const streams = probeData.streams || [];
  const ext = path.extname(filePath).toLowerCase();
  const audioStreams = streams.filter((s) => s.codec_type === 'audio').map((s, i) => trackLabel(s, 'a', i));
  const subtitleStreams = streams.filter((s) => s.codec_type === 'subtitle').map((s, i) => trackLabel(s, 's', i));
  const videoStream = streams.find((s) => s.codec_type === 'video') || null;

  const isNativeContainer = NATIVE_CONTAINER_EXTENSIONS.has(ext);
  const videoOk = !!videoStream && BROWSER_VIDEO_CODECS.has(videoStream.codec_name);
  const defaultAudio = audioStreams.find((a) => a.default) || audioStreams[0] || null;
  const audioOk = !!defaultAudio && BROWSER_AUDIO_CODECS.has(defaultAudio.codec);

  // Direct (raw, byte-range) playback is only safe when the container is
  // one browsers handle natively AND both the video and the *default*
  // audio track are codecs the browser can decode itself. Anything else
  // needs ffmpeg to remux (e.g. MKV, or an unsupported codec like AC3/HEVC).
  const canPassthrough = isNativeContainer && videoOk && audioOk;
  // Even when the container itself needs fixing (the common MKV case),
  // if the codecs inside are already fine, that's just a fast container
  // repackage (stream copy, no re-encoding) rather than a real
  // transcode - cheap enough to pre-generate as a complete, real file
  // that supports Range requests and native seeking, instead of an
  // indefinite live pipe. This matters a lot for mobile browsers (iOS
  // Safari especially), which are far stricter than desktop about
  // needing genuine Range/Content-Length support to play video at all.
  const canRangeSeek = canPassthrough || (videoOk && audioOk);
  const duration = probeData.format && probeData.format.duration ? parseFloat(probeData.format.duration) : null;

  return {
    chapters: (probeData.chapters || []).map((chapter, index) => ({ start: Number(chapter.start_time), end: Number(chapter.end_time), title: String(chapter.tags?.title || `Chapter ${index + 1}`) })).filter(chapter => Number.isFinite(chapter.start) && chapter.start >= 0 && Number.isFinite(chapter.end) && chapter.end > chapter.start),
    audioStreams,
    subtitleStreams,
    videoStream,
    canPassthrough,
    canRangeSeek,
    videoCodecOk: videoOk,
    videoCodec: videoStream ? videoStream.codec_name : null,
    duration,
    defaultAudioIndex: defaultAudio ? defaultAudio.index : null,
    videoWidth: videoStream ? videoStream.width : null,
    videoHeight: videoStream ? videoStream.height : null,
  };
}

// Remux/transcode: copies video when it's already a browser-safe codec,
// otherwise re-encodes it to H.264 (this is what actually fixes HEVC/H.265
// and similar files - copying an incompatible video codec into a new
// container doesn't make it decodable, it just repackages the same bytes).
// Audio is always transcoded to AAC. Output is a fragmented MP4 so it can
// be piped as it's produced (no need to wait for the whole file / no
// seekable byte length).
// Builds the video-encode portion of the ffmpeg command for whichever
// encoder we're using (hardware QSV/VAAPI, or software libx264 as the
// universal fallback). Returns { pre, args }: `pre` is global/init
// options that must appear before -i (e.g. initializing a VAAPI device),
// `args` is the usual output-side options (filters + codec).
function buildVideoEncodeArgs(targetHeight, reencodeVideo, hwaccel, decodeHwaccel) {
  const needsEncode = !!(targetHeight || reencodeVideo);
  if (!needsEncode) return { pre: [], args: ['-c:v', 'copy'] };

  const scaleFilter = targetHeight ? `scale=-2:${targetHeight}` : null;
  // Lower CRF/quality number = higher quality. The codec-fix path (no
  // resize, just making an incompatible codec playable) uses a slightly
  // higher-quality setting than a deliberate quality-tier downscale.
  const quality = targetHeight ? 23 : 20;
  const hw = hwaccel || { type: 'none' };

  if (hw.type === 'qsv') {
    const args = [];
    // format=nv12 forces standard 8-bit 4:2:0 output regardless of the
    // source's bit depth - without this, a 10-bit HEVC source (common
    // in real anime releases) produces "H.264 High 10 Profile" output,
    // which essentially no hardware H.264 decoder supports, including
    // iOS's. That's exactly the failure mode of audio playing while
    // video doesn't: the audio track is completely unaffected, while
    // the video track is fundamentally undecodable on the device.
    //
    // When QSV hardware decode is also active AND the source is 10-bit
    // (very common for real anime releases - confirmed directly from a
    // real failure: a genuine "hevc Main 10, yuv420p10le" source), a
    // plain hwdownload+format filter chain doesn't work - confirmed
    // directly, twice: once from a real ffmpeg run's own warning about
    // frames defaulting to staying QSV-resident, then again from an
    // actual "Invalid output format nv12 for hwframe download" failure
    // after adding hwdownload to address that. Further research traced
    // this to a specific, already-documented FFmpeg/driver limitation -
    // confirmed directly from FFmpeg's own official bug tracker
    // (trac.ffmpeg.org #7764): a 10-bit QSV surface can't be downloaded
    // directly as 8-bit nv12 through hwdownload+format at all; going
    // through the QSV hardware scaler filter itself (scale_qsv, which
    // can do the bit-depth conversion QSV-side) is the documented,
    // working alternative for exactly this case, confirmed by multiple
    // independent sources. The plain software scale+format chain below
    // is kept completely unchanged for the software-decode path - this
    // only applies when frames actually arrive as QSV hardware
    // surfaces in the first place.
    let vf;
    if (decodeHwaccel) {
      vf = targetHeight ? `scale_qsv=w=-1:h=${targetHeight}:format=nv12` : 'scale_qsv=format=nv12';
    } else {
      vf = [scaleFilter, 'format=nv12'].filter(Boolean).join(',');
    }
    args.push('-vf', vf);
    args.push('-c:v', 'h264_qsv', '-preset', 'faster', '-global_quality', String(quality), '-profile:v', 'high');
    return { pre: [], args };
  }
  if (hw.type === 'nvenc') {
    const args = [];
    // Same reasoning as the QSV comment above - forces 8-bit output
    // regardless of source bit depth, which a 10-bit HEVC source would
    // otherwise silently violate.
    const vf = [scaleFilter, 'format=nv12'].filter(Boolean).join(',');
    args.push('-vf', vf);
    // -cq (constant quality) uses the same rough 0-51 scale as x264's
    // CRF, so the same quality numbers translate reasonably directly.
    // p4 is NVENC's mid-speed preset - a good default balance for
    // real-time transcoding without needing per-GPU tuning.
    args.push('-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', String(quality), '-profile:v', 'high');
    return { pre: [], args };
  }
  if (hw.type === 'amf') {
    const args = [];
    // Same reasoning as the QSV comment above.
    const vf = [scaleFilter, 'format=nv12'].filter(Boolean).join(',');
    args.push('-vf', vf);
    // Deliberately minimal option set here - AMF's exact option names
    // are harder to verify without real AMD hardware to test against,
    // so this leans on well-documented basics (encoder + speed-biased
    // quality preset) rather than finer-grained rate control knobs that
    // are more likely to differ across AMF/driver versions.
    args.push('-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'vbr_latency', '-b:v', targetHeight ? '2M' : '4M', '-profile:v', 'high');
    return { pre: [], args };
  }
  if (hw.type === 'vaapi') {
    const vf = scaleFilter
      ? `format=nv12,hwupload,scale_vaapi=w=-2:h=${targetHeight}`
      : 'format=nv12,hwupload';
    return {
      pre: ['-vaapi_device', hw.device],
      args: ['-vf', vf, '-c:v', 'h264_vaapi', '-qp', String(quality)],
    };
  }
  // Software fallback - veryfast preset trades some compression
  // efficiency for encode speed, which matters here since this has to
  // keep up with real-time playback without a hardware encoder's help.
  const args = [];
  if (scaleFilter) args.push('-vf', scaleFilter);
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(quality), '-profile:v', 'high', '-pix_fmt', 'yuv420p');
  return { pre: [], args };
}

// Builds the audio-encode portion of the command. If the selected track
// is already a codec browsers can decode (e.g. this is a "just downscale
// the resolution" request on a file whose audio was already fine), we
// copy it bit-for-bit instead of needlessly re-encoding - re-encoding
// audio that doesn't need it is a pointless second lossy compression
// pass with no benefit, just quality loss and wasted CPU.
function buildAudioEncodeArgs(copyAudio, channels) {
  if (copyAudio) return ['-c:a', 'copy'];
  // Scale bitrate with channel count so surround sources don't get
  // starved - 96kbps/channel keeps stereo at a clearly-above-average
  // 192k while giving 5.1/7.1 enough headroom to stay clean rather than
  // squeezing many channels into a stereo-sized budget.
  const ch = channels && channels > 0 ? channels : 2;
  const bitrateK = Math.min(640, Math.max(192, ch * 96));
  return ['-c:a', 'aac', '-b:a', `${bitrateK}k`, '-ac', String(Math.min(ch, 6))];
}

function spawnTranscode({ filePath, audioStreamIndex, startSeconds, targetHeight, reencodeVideo, hwaccel, copyAudio, audioChannels, outputPath }) {
  const { pre, args: videoArgs } = buildVideoEncodeArgs(targetHeight, reencodeVideo, hwaccel);
  const audioArgs = buildAudioEncodeArgs(copyAudio, audioChannels);
  const args = [...pre];
  if (startSeconds && startSeconds > 0) {
    // Fast (keyframe) input-side seek. -noaccurate_seek is important here:
    // without it, ffmpeg trims the (decoded/re-encoded) audio stream down to
    // the exact requested second while the (copied) video stream can only
    // start at the nearest keyframe - the two streams end up cut at
    // different points in the source, which plays back as audio and video
    // being out of sync right after a resume/seek. Disabling accurate-seek
    // makes both streams start from the same demuxed position instead.
    args.push('-noaccurate_seek');
    args.push('-ss', String(startSeconds));
  }
  args.push('-i', filePath);
  args.push('-map', '0:v:0');
  if (audioStreamIndex != null) {
    args.push('-map', `0:${audioStreamIndex}`);
  } else {
    args.push('-map', '0:a:0?');
  }

  args.push(...videoArgs);
  args.push(...audioArgs);
  args.push('-avoid_negative_ts', 'make_zero');

  if (outputPath) {
    // Writing a real, complete file (for caching + Range-serving
    // afterward) - faststart puts the seek index at the front so
    // playback can begin immediately once the file is handed off,
    // rather than needing the fragmented-streaming flags below.
    args.push('-movflags', '+faststart', '-f', 'mp4', outputPath);
  } else {
    args.push(
      // separate_moof gives each track its own fragment header per chunk,
      // which fixes a known class of audio/video desync in fragmented MP4
      // when one track is copied and the other is transcoded (their natural
      // packet cadence differs, and a shared moof can end up describing the
      // wrong track's timing). max_muxing_queue_size avoids ffmpeg silently
      // dropping packets (another desync source) if the audio encoder ever
      // falls a bit behind the instantly-available copied video packets.
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof+separate_moof',
      '-max_muxing_queue_size', '9999',
      '-f', 'mp4',
      'pipe:1'
    );
  }
  return trackLive(spawn('ffmpeg', args));
}

// HLS output: segments + a growing playlist, instead of one monolithic
// file. This is what actually solves the "mobile has to wait for the
// entire transcode before playback can start at all" problem - a
// player can start playing as soon as the first few segments exist,
// and keep discovering new ones as they're written, rather than
// needing the whole thing done upfront. force_key_frames ensures a
// keyframe lands at each segment boundary regardless of encoder or
// source framerate, so segments are clean and independently
// decodable (needed for seeking to work reliably).
function spawnHlsTranscode({ filePath, audioStreamIndex, targetHeight, reencodeVideo, hwaccel, copyAudio, audioChannels, outputDir, segmentSeconds, decodeHwaccel, startOffsetSeconds }) {
  const { pre, args: videoArgs } = buildVideoEncodeArgs(targetHeight, reencodeVideo, hwaccel, decodeHwaccel);
  const audioArgs = buildAudioEncodeArgs(copyAudio, audioChannels);
  const segDuration = segmentSeconds || 6;
  // Hardware-accelerated decode, not just encode - matters most for a
  // source codec that's expensive to decode in software (AV1 in
  // particular can run well under real-time speed in pure software,
  // meaning a transcode may never actually catch up to what's needed
  // for playback to start at all). Kept as a separate, opt-in flag
  // rather than always-on: decode hwaccel support for a given source
  // codec varies by exact hardware/driver, and the caller needs to be
  // able to retry without it if a specific combination genuinely isn't
  // supported, rather than a hard failure with no way to recover.
  const decodePre = [];
  if (decodeHwaccel) {
    if (hwaccel.type === 'qsv') decodePre.push('-hwaccel', 'qsv', '-hwaccel_output_format', 'qsv');
    else if (hwaccel.type === 'nvenc') decodePre.push('-hwaccel', 'cuda');
    // AMD on Windows: d3d11va is Microsoft's generic, cross-vendor
    // hardware decode API (also works for Intel/NVIDIA, but they
    // already have their own dedicated paths above) - AMD doesn't
    // expose decode through "AMF" the way it exposes encode through
    // it. Deliberately doesn't request GPU-resident output frames, so
    // decoded frames land back in system memory exactly the way
    // software decode already does - the existing amf encode path
    // below expects exactly that, unchanged, and this keeps decode/
    // encode interop simple and safe without real AMD hardware here
    // to verify a fully zero-copy pipeline against.
    else if (hwaccel.type === 'amf') decodePre.push('-hwaccel', 'd3d11va');
    // Linux (Intel/AMD via VAAPI) - same reasoning as amf above: no
    // GPU-resident output format requested, so frames come back to
    // system memory the same way the existing vaapi encode path (which
    // does its own hwupload from system memory) already expects.
    else if (hwaccel.type === 'vaapi') decodePre.push('-hwaccel', 'vaapi', '-hwaccel_device', hwaccel.device);
  }
  const seekPre = startOffsetSeconds ? ['-ss', String(startOffsetSeconds)] : [];
  const args = [...decodePre, ...seekPre, ...pre, '-i', filePath, '-map', '0:v:0'];
  if (audioStreamIndex != null) {
    args.push('-map', `0:${audioStreamIndex}`);
  } else {
    args.push('-map', '0:a:0?');
  }
  args.push(...videoArgs);
  args.push(...audioArgs);
  args.push(
    '-force_key_frames', `expr:gte(t,n_forced*${segDuration})`,
    // Without this, the encoder can insert its own additional
    // keyframes wherever it detects a scene change, on top of the
    // explicit, time-based schedule above - which can shift where a
    // segment boundary actually lands relative to where it was
    // intended, producing a segment that doesn't cleanly start on the
    // keyframe hls.js expects it to.
    '-sc_threshold', '0',
    '-f', 'hls',
    '-hls_time', String(segDuration),
    // "event" (not the default "vod") is the important part - it tells
    // the player this playlist will keep growing, so it should start
    // playing what's already there instead of waiting for an
    // end-of-list marker that won't show up until the whole transcode
    // is actually done.
    '-hls_playlist_type', 'event',
    // Each segment starts with a keyframe and carries its own timing
    // info, so it can be decoded on its own - needed for seeking to a
    // segment that hasn't been played sequentially into yet.
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', path.join(outputDir, 'seg%05d.ts'),
    path.join(outputDir, 'playlist.m3u8'),
  );
  console.log(`[hls-debug-cmd] ffmpeg ${args.join(' ')}`);
  return trackLive(spawn('ffmpeg', args));
}

function spawnSubtitleExtract({ filePath, subtitleStreamIndex }) {
  const args = ['-i', filePath, '-map', `0:${subtitleStreamIndex}`, '-f', 'webvtt', 'pipe:1'];
  return trackLive(spawn('ffmpeg', args));
}

module.exports = {
  HAS_FFMPEG,
  HAS_FFPROBE,
  probe,
  analyzeStreams,
  spawnTranscode,
  spawnHlsTranscode,
  spawnSubtitleExtract,
  killAllLive,
  trackLive,
  BROWSER_AUDIO_CODECS,
};

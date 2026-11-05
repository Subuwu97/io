window.IOPlaybackMeasurements = class {
  constructor(video, getMode) {
    // The fallback is only a measurement ID, never an authentication token.
    const id = window.crypto?.randomUUID?.() || Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
    const started = performance.now(); this.data = { id, startupMs: 0, stallCount: 0, stallMs: 0, droppedFrames: 0, totalFrames: 0, errorCount: 0 };
    let stalledAt = null, began = false, frameId = null;
    if (video.requestVideoFrameCallback) frameId = video.requestVideoFrameCallback(() => { this.data.startupMs = performance.now() - started; frameId = null; });
    const finishStall = () => { if (stalledAt !== null) { this.data.stallMs += performance.now() - stalledAt; stalledAt = null; } };
    const playing = () => { if (!began) { began = true; if (!video.requestVideoFrameCallback) this.data.startupMs = performance.now() - started; } finishStall(); };
    const waiting = () => { if (began && !video.paused && !video.seeking && stalledAt === null) { this.data.stallCount++; stalledAt = performance.now(); } };
    const failed = () => { this.data.errorCount++; };
    this.recordError = failed;
    video.addEventListener('playing', playing); video.addEventListener('waiting', waiting); video.addEventListener('stalled', waiting);
    video.addEventListener('error', failed); video.addEventListener('pause', finishStall); video.addEventListener('seeking', finishStall);
    const snapshot = () => {
      const quality = video.getVideoPlaybackQuality?.();
      this.data.droppedFrames = quality?.droppedVideoFrames || 0; this.data.totalFrames = quality?.totalVideoFrames || 0;
      this.data.mode = getMode();
      const measured = { ...this.data, stallMs: this.data.stallMs + (stalledAt === null ? 0 : performance.now() - stalledAt) };
      return measured;
    };
    const report = () => { if (began) fetch('/api/playback/metrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot()), keepalive: true }).catch(() => {}); };
    const upload = setInterval(report, 15000);
    this.destroy = () => {
      finishStall(); report(); clearInterval(upload);
      if (frameId !== null) video.cancelVideoFrameCallback?.(frameId);
      for (const [name, handler] of [['playing', playing], ['waiting', waiting], ['stalled', waiting], ['error', failed], ['pause', finishStall], ['seeking', finishStall]]) video.removeEventListener(name, handler);
    };
  }
};

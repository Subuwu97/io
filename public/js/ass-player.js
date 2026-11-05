// Preserve authored ASS effects; no subtitle script is executed as JavaScript.
window.IOAss = class {
  constructor(video) { this.video = video; this.instance = null; this.generation = 0; this.lyrics = []; }
  async clear() {
    const generation = ++this.generation; const old = this.instance; this.instance = null; this.lyrics = [];
    if (old) {
      let timer;
      await Promise.race([old.destroy().catch(() => {}), new Promise(resolve => {
        // The pinned JASSUB version waits for ready during destroy.
        timer = setTimeout(() => { old._worker?.terminate(); resolve(); }, 1000);
      })]);
      clearTimeout(timer);
    }
    return generation;
  }
  async load({ showId, encodedRelPath, track, offset = 0, soft = false }) {
    const generation = await this.clear();
    if (generation !== this.generation) return false;
    const base = `/api/ass/${encodeURIComponent(showId)}/${encodedRelPath}?track=${track}`;
    const response = await fetch(base + '&manifest=1');
    if (!response.ok) throw new Error((await response.json()).error || 'Could not load styled subtitles');
    const manifest = await response.json();
    if (generation !== this.generation) return false;
    if (soft) { this.lyrics = manifest.lyrics || []; return false; }
    if (!window.OffscreenCanvas || !window.WebAssembly || !window.Worker) throw new Error('This browser does not support the styled subtitle renderer');
    const { default: JASSUB } = await import('/vendor/jassub/jassub.js');
    if (generation !== this.generation) return false;
    const instance = new JASSUB({ video: this.video, subUrl: base, timeOffset: offset,
      fonts: manifest.fonts.map(index => base + `&font=${index}`), queryFonts: false,
      maxRenderHeight: 1080, libassMemoryLimit: 64, libassGlyphLimit: 2000,
      workerUrl: '/vendor/jassub/worker/worker.js', wasmUrl: '/vendor/jassub/wasm/jassub-worker.wasm',
      modernWasmUrl: '/vendor/jassub/wasm/jassub-worker-modern.wasm',
      wasmWorkerUrl: '/vendor/jassub/wasm/jassub-worker.js', modernWasmWorkerUrl: '/vendor/jassub/wasm/jassub-worker-modern.js' });
    this.instance = instance;
    let timer;
    try { await Promise.race([instance.ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Styled subtitle renderer timed out')), 15000); })]); }
    catch (error) { if (this.instance === instance) await this.clear(); throw error; }
    finally { clearTimeout(timer); }
    if (generation !== this.generation) { await instance.destroy().catch(() => {}); return false; }
    return true;
  }
};

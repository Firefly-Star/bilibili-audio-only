// live-audio.js -- 直播「仅播声音」的真正实现（world:MAIN，随播放器 iframe 一起跑）
//
//  1) 用 only_audio=1 调 getRoomPlayInfo —— 服务端发的是**音频流的 stream key**
//     （实测返回的 FLV 里只有 type=8 音频 tag，0 个 type=9 视频 tag）
//  2) 把这个 FLV 拉下来，按 tag 拆包（11 字节头 + 数据 + 4 字节尾）
//  3) AAC 帧交给 WebCodecs AudioDecoder 解码
//  4) 解码结果走 WebAudio 播放（GainNode 控制音量）
//
// 同时把页面上的 <video> 暂停掉 —— 那条混流才是流量大头。
(() => {
  const KEY = 'bili-live-audio-only';
  const VOL_KEY = 'bili-live-volume';
  let on = false;
  try { on = localStorage.getItem(KEY) === '1'; } catch (e) {}
  if (!on) return;
  if (window.__biliLiveAudio) return;

  const room = (location.pathname.match(/(\d{4,})/) || [])[1];
  if (!room) return;

  const st = (window.__biliLiveAudio = { state: 'init', bytes: 0, tags: 0, decoded: 0, errors: [], startedAt: Date.now() });
  const pub = () => {
    try {
      const d = document.documentElement.dataset;
      d.aoAudio = st.state;
      d.aoKbps = String(Math.round((st.bytes / 1024) / Math.max(1, (Date.now() - st.startedAt) / 1000)));
      d.aoBytes = String(st.bytes);
      d.aoErr = st.errors.slice(0, 2).join(' | ');
      d.aoCtx = ctx ? ctx.state : 'none';
      d.aoUA = String(!!(navigator.userActivation && navigator.userActivation.hasBeenActive));
      // 声音真正开起来（有手势之后 AudioContext 才会 running）
      if (ctx && ctx.state === 'running' && (st.state === 'need-gesture' || st.state === 'connecting')) st.state = 'playing';
    } catch (e) {}
  };

  const vol = () => {
    let v = 0.8;
    try { const s = localStorage.getItem(VOL_KEY); if (s !== null) v = Math.max(0, Math.min(1, Number(s))); } catch (e) {}
    return Number.isFinite(v) ? v : 0.8;
  };

  let ctx, gain, decoder, stopped = false;
  let wakeLock = null;

  // 页面上的视频一直暂停，混流才会真的停
  const keepPaused = () => {
    const v = document.querySelector('video');
    if (v && !v.paused) { try { v.pause(); } catch (e) {} }
  };
  setInterval(keepPaused, 1500);

  async function ensureContext() {
    if (!ctx) {
      ctx = new AudioContext();
      gain = ctx.createGain();
      gain.gain.value = vol();
      gain.connect(ctx.destination);
      setInterval(() => { if (gain && Math.abs(gain.gain.value - vol()) > 0.01) gain.gain.value = vol(); }, 800);
    }
    if (ctx.state === 'suspended') {
      // 没有用户手势时 resume() 的 promise 会一直挂着 —— 不能 await 它，否则整条流水线卡死
      ctx.resume().catch(() => {});
    }
    return ctx.state === 'running';
  }

  // 没有用户手势时 AudioContext 起不来，等第一次点击
  const armGesture = () => {
    const h = async () => {
      await ensureContext();
      if (ctx && ctx.state === 'running') {
        window.removeEventListener('pointerdown', h, true);
        st.state = 'connecting'; pub();
      }
    };
    window.addEventListener('pointerdown', h, true);
  };

  const SR = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const ascInfo = (a) => {
    const b0 = a[0], b1 = a[1];
    return { sampleRate: SR[((b0 & 7) << 1) | ((b1 >> 7) & 1)] || 48000, channels: ((b1 >> 3) & 15) || 2 };
  };

  let nextTime = 0, sched = 0;
  const play = (ad) => {
    try {
      if (!ctx || ctx.state !== 'running') { return; }   // 还没拿到用户手势，丢掉，避免堆一堆延迟
      const ch = Math.min(2, ad.numberOfChannels);
      const buf = ctx.createBuffer(ch, ad.numberOfFrames, ad.sampleRate);
      for (let c = 0; c < ch; c++) {
        const arr = new Float32Array(ad.numberOfFrames);
        ad.copyTo(arr, { planeIndex: c, format: 'f32-planar' });
        buf.copyToChannel(arr, c);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      if (nextTime < ctx.currentTime + 0.05) nextTime = ctx.currentTime + 0.12;
      const t = nextTime;
      src.start(t);
      nextTime = t + buf.duration;
      sched += buf.duration;
      st.decoded++;
    } catch (e) { if (st.errors.length < 5) st.errors.push(String(e).slice(0, 80)); }
    finally { try { ad.close(); } catch (e) {} }
  };

  async function getStreamUrl() {
    const qs = new URLSearchParams({ room_id: room, protocol: '0,1', format: '0', codec: '0', qn: '10000', platform: 'web', ptype: '8', only_audio: '1' });
    const r = await fetch('https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?' + qs, { credentials: 'include' });
    const j = await r.json();
    const s = j && j.data && j.data.playurl_info && j.data.playurl_info.playurl && j.data.playurl_info.playurl.stream;
    if (!s) throw new Error('no stream ' + (j && j.code));
    const c = s[0].format[0].codec[0];
    const ui = (c.url_info || [])[0];
    return ui.host + c.base_url + (ui.extra || '');
  }

  async function runOnce() {
    const url = await getStreamUrl();
    const ac = new AbortController();
    const bail = setTimeout(() => ac.abort(), 20000);
    const r = await fetch(url, { signal: ac.signal });
    clearTimeout(bail);
    if (!r.ok) throw new Error('flv ' + r.status);
    const reader = r.body.getReader();
    let buf = new Uint8Array(0), header = false, ts = 0;

    while (!stopped) {
      const { done, value } = await reader.read();
      if (done) break;
      st.bytes += value.length;
      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf); merged.set(value, buf.length); buf = merged;
      if (!header) { if (buf.length < 13) continue; header = true; buf = buf.slice(13); }

      let i = 0;
      while (i + 11 <= buf.length) {
        const size = (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3];
        const total = 11 + size + 4;
        if (i + total > buf.length) break;
        if (buf[i] === 8) {
          st.tags++;
          const d = buf.slice(i + 11, i + 11 + size);
          if (d[1] === 0) {
            if (!decoder) {
              const cfg = ascInfo(d.slice(2));
              decoder = new AudioDecoder({ output: play, error: (e) => { if (st.errors.length < 5) st.errors.push('dec ' + e.message); } });
              decoder.configure({ codec: 'mp4a.40.2', sampleRate: cfg.sampleRate, numberOfChannels: cfg.channels, description: d.slice(2) });
            }
          } else if (decoder) {
            try { decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: ts, duration: 23220, data: d.slice(2) })); } catch (e) {}
            ts += 23220;
          }
        }
        i += total;
      }
      buf = buf.slice(i);
      pub();
    }
    reader.cancel().catch(() => {});
  }

  async function loop() {
    st.state = 'connecting'; pub();
    const ok = await ensureContext();
    if (!ok) { st.state = 'need-gesture'; pub(); armGesture(); }
    while (!stopped) {      try {
        await runOnce();
        st.state = 'reconnecting'; pub();
        await new Promise((r) => setTimeout(r, 1500));
      } catch (e) {
        if (st.errors.length < 5) st.errors.push(String(e).slice(0, 80));
        st.state = 'error'; pub();
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
  }

  const waitVideo = setInterval(() => {
    if (document.querySelector('video')) {
      clearInterval(waitVideo);
      keepPaused();
      loop();
    }
  }, 800);
  // 播放器在 iframe 里，顶层页面没有 video：12 秒还没等到就退出，避免重复拉流
  setTimeout(() => {
    clearInterval(waitVideo);
    if (!document.querySelector('video')) { stopped = true; st.state = 'no-video'; pub(); }
  }, 12000);
})();

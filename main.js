// main.js -- runs in the page's own JS context (world: MAIN), at document_start.
//
// 1) 把 __playinfo__ 里的 dash.video 删掉：播放器只拉音轨（页面内嵌的 DASH 清单就是这么用的）
// 2) 顺手统计音频分片的字节数 -> 实时 KB/s，写到 <html data-ao-kbps>
// 3) 按清单里的 bandwidth 算出「按码率算能省多少」，写到 <html data-ao-saving>
(() => {
  if (window.__biliAudioOnly) return;

  const KEY = 'bili-audio-only';
  const isOn = () => { try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; } };

  const st = (window.__biliAudioOnly = {
    installed: true, enabled: isOn(), seen: 0, stripped: 0, videoIds: [], audioIds: [], error: null
  });


  const strip = (obj) => {
    st.seen++;
    st.enabled = isOn();
    if (!st.enabled) return obj;
    try {
      const d = obj && obj.data;
      if (d && d.dash && Array.isArray(d.dash.video) && d.dash.video.length) {
        st.videoIds = d.dash.video.map((v) => v.id);
        st.audioIds = (d.dash.audio || []).map((a) => a.id);
        d.dash.video = [];
        st.stripped++;
      }
    } catch (e) { st.error = String((e && e.message) || e); }
    return obj;
  };

  let stored;
  Object.defineProperty(window, '__playinfo__', {
    configurable: true,
    enumerable: true,
    get() { return stored; },
    set(v) { stored = strip(v); }
  });

  // ---- 实时流量：只统计音轨分片（-1-302xx.m4s） ----
  const audioSeg = /-1-302\d\d\.m4s/i;
  const flow = (window.__biliAudioFlow = { total: 0, marks: [], startedAt: Date.now() });
  const note = (url, n) => {
    if (!audioSeg.test(String(url || '')) || !n) return;
    flow.total += n;
    flow.marks.push([Date.now(), n]);
  };

  const XP = XMLHttpRequest.prototype;
  if (!XP.open.__ao) {
    const oOpen = XP.open, oSend = XP.send;
    XP.open = function (m, u) { try { this.__aoUrl = String(u || ''); } catch (e) {} return oOpen.apply(this, arguments); };
    XP.open.__ao = true;
    XP.send = function () {
      const url = this.__aoUrl;
      if (audioSeg.test(String(url || ''))) {
        this.addEventListener('load', function () {
          try { note(url, this.response ? (this.response.byteLength || this.responseText.length) : 0); } catch (e) {}
        });
      }
      return oSend.apply(this, arguments);
    };
  }

  const of = window.fetch;
  if (of && !of.__ao) {
    window.fetch = function (input) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const p = of.apply(this, arguments);
      if (audioSeg.test(String(url || ''))) {
        p.then((r) => r.clone().arrayBuffer().then((b) => note(url, b.byteLength)).catch(() => {})).catch(() => {});
      }
      return p;
    };
    window.fetch.__ao = true;
  }

  const publish = () => {
    try {
      const root = document.documentElement;
      if (!root) return;
      root.dataset.aoEnabled = st.enabled ? '1' : '0';
      root.dataset.aoStripped = String(st.stripped);

      const now = Date.now(), cut = now - 60000;
      while (flow.marks.length && flow.marks[0][0] < cut) flow.marks.shift();
      const sum = flow.marks.reduce((a, m) => a + m[1], 0);
      const span = Math.max(5, (now - (flow.marks.length ? flow.marks[0][0] : now)) / 1000);
      // 播放器是「预取一段 → 停手 → 快用完再取」，所以 60 秒窗口比瞬时值稳
      const rate = sum > 0 ? Math.round(sum / 1024 / span) : 0;
      root.dataset.aoKbps = String(rate);
      const s = window.__INITIAL_STATE__;
      const pic = s && s.videoData && s.videoData.pic;
      if (pic && !root.dataset.aoCover) root.dataset.aoCover = pic;
    } catch (e) {}
  };

  [0, 120, 500, 1500, 4000].forEach((ms) => setTimeout(publish, ms));
  setInterval(publish, 1000);
})();



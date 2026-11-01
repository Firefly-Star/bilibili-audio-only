// live.js -- 直播页的 UI 层（isolated world）：音频模式界面 + 音量 + 开关消息。
// 真正的取流/解码在 live-audio.js（MAIN world）里，这里只负责画界面和读它发布的状态。
(() => {
  const KEY = 'bili-live-audio-only';
  const VOL_KEY = 'bili-live-volume';
  const isOn = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };

  if (window.top === window) {
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (!msg) return;
      if (msg.type === 'la:get') { reply({ on: isOn() }); return true; }
      if (msg.type === 'la:set') {
        try { localStorage.setItem(KEY, msg.on ? '1' : '0'); } catch (e) {}
        reply({ ok: true });
        setTimeout(() => location.reload(), 100);
        return true;
      }
    });
  }

  const LABEL = {
    init: '正在准备…', connecting: '正在连接音频流…', reconnecting: '重连中…',
    playing: '正在播放（仅音频）',
    error: '连接失败，重试中…', 'need-gesture': '点一下播放器开始播放声音', 'no-video': '等待播放器…'
  };

  function ensureOverlay(host) {
    let o = host.querySelector(':scope > .ao-live');
    if (!o) {
      o = document.createElement('div');
      o.className = 'ao-live';
      o.innerHTML =
        '<div class="ao-live-bars"><span></span><span></span><span></span><span></span><span></span></div>' +
        '<div class="ao-live-title"></div>' +
        '<div class="ao-live-sub">🎧 仅播放声音 · 直播画面已隐藏</div>' +
        '<div class="ao-live-state"></div>' +
        '<div class="ao-live-ctrl"><span>音量</span><input type="range" min="0" max="100" step="1"></div>';
      const inp = o.querySelector('input[type=range]');
      let v = 80;
      try { const s = localStorage.getItem(VOL_KEY); if (s !== null) v = Math.round(Number(s) * 100); } catch (e) {}
      inp.value = String(Math.max(0, Math.min(100, v)));
      inp.addEventListener('input', () => {
        try { localStorage.setItem(VOL_KEY, String(Number(inp.value) / 100)); } catch (e) {}
      });
      host.appendChild(o);
    }
    const t = o.querySelector('.ao-live-title');
    const title = (document.title || '').split(' - ')[0].trim();
    if (t && title && t.textContent !== title) t.textContent = title;

    const d = document.documentElement.dataset;
    const state = d.aoAudio || 'init';
    const el = o.querySelector('.ao-live-state');
    if (el) {
      const kbps = d.aoKbps && state === 'init' ? '' : (d.aoKbps ? ' · ' + d.aoKbps + ' KB/s' : '');
      const text = (LABEL[state] || state) + kbps;
      if (el.textContent !== text) el.textContent = text;
    }
    return o;
  }

  function paint() {
    if (!isOn()) return;
    const v = document.querySelector('video');
    if (!v) return;
    v.style.opacity = '0';
    const host = v.closest('#live-player') || v.parentElement;
    if (!host) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.style.background = '#0b0f17';
    ensureOverlay(host);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
  else paint();
  setInterval(paint, 1000);
})();

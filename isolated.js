// isolated.js -- 点播视频页的 UI（isolated world）：音频模式界面 + 开关。
// 和直播页同一个视觉：跳动的电平条 + 标题 + 实时 KB/s，而不是封面图。
(() => {
  const KEY = 'bili-audio-only';
  const isOn = () => { try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; } };

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg) return;
    if (msg.type === 'ao:get') { reply({ on: isOn() }); return true; }
    if (msg.type === 'ao:set') {
      try { localStorage.setItem(KEY, msg.on ? '1' : '0'); } catch (e) {}
      reply({ ok: true });
      setTimeout(() => location.reload(), 100);   // __playinfo__ 已经被消费过，必须重载才生效
      return true;
    }
  });

  function videoTitle() {
    const h1 = document.querySelector('h1.video-title, h1[title], .video-title');
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    return (document.title || '').split('_')[0].replace(/【[^】]*】/g, '').trim();
  }

  function ensureOverlay(host) {
    let o = host.querySelector(':scope > .ao-live');
    if (!o) {
      o = document.createElement('div');
      o.className = 'ao-live';
      o.innerHTML =
        '<div class="ao-live-bars"><span></span><span></span><span></span><span></span><span></span></div>' +
        '<div class="ao-live-title"></div>' +
        '<div class="ao-live-sub">🎧 仅播放声音 · 画面已关闭，只加载音轨</div>' +
        '<div class="ao-live-state"></div>';
      host.appendChild(o);
    }
    const t = o.querySelector('.ao-live-title');
    const title = videoTitle();
    if (t && title && t.textContent !== title) t.textContent = title;

    const d = document.documentElement.dataset;
    const kbps = Number(d.aoKbps || 0);
    const text = kbps > 0 ? '正在播放（仅音频） · ' + kbps + ' KB/s' : '已缓冲（暂停下载）';
    const el = o.querySelector('.ao-live-state');
    if (el && el.textContent !== text) el.textContent = text;
    return o;
  }

  function paint() {
    if (!isOn()) return;
    const v = document.querySelector('video');
    if (!v) return;
    // 没有视频轨，video 元素只会画一块黑 / 一张封面；直接透明掉，露出下面的音频界面
    v.style.opacity = '0';
    const wrap = v.closest('.bpx-player-video-wrap') || v.parentElement;
    if (!wrap) return;
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    wrap.style.background = '#0b0f17';
    ensureOverlay(wrap);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
  else paint();
  setInterval(paint, 1000);   // 播放器切集/换画质会重绘，隔一会儿补一次
})();


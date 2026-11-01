const cb = document.getElementById('on');
const hint = document.getElementById('hint');

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (tab && tab.url) || '';
  const isVideo = /^https:\/\/www\.bilibili\.com\/video\//.test(url);
  const isLive = /^https:\/\/live\.bilibili\.com\//.test(url);
  if (!isVideo && !isLive) {
    cb.disabled = true;
    hint.textContent = '请先打开一个 B 站视频或直播间页面。';
    return;
  }
  const prefix = isLive ? 'la' : 'ao';
  if (isLive) hint.textContent = '直播是单条混流，此模式只隐藏画面，流量不变。';
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: prefix + ':get' });
    cb.checked = !!(r && r.on);
  } catch (e) {
    hint.textContent = '页面脚本没就绪，刷新一下再试。';
  }
  cb.addEventListener('change', async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: prefix + ':set', on: cb.checked });
    } catch (e) {
      hint.textContent = '切换失败：' + e.message;
    }
  });
})();

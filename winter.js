(() => {
  'use strict';
  const button = document.querySelector('[data-loop]');
  if (!button) return;
  const picture = button.querySelector('img');
  const caption = document.querySelector('[data-loop-label]');
  const status = document.querySelector('[data-loop-status]');
  const poster = picture.getAttribute('src');
  let playing = false;
  function update(next) {
    playing = next;
    picture.src = playing ? button.dataset.loop : poster;
    button.setAttribute('aria-pressed', String(playing));
    button.setAttribute('aria-label', playing ? '暂停树下动图' : '播放树下动图');
    caption.textContent = playing ? '暂停动图' : '播放动图';
  }
  button.addEventListener('click', () => {
    status.textContent = '';
    update(!playing);
  });
  picture.addEventListener('error', () => {
    if (!playing) return;
    update(false);
    status.textContent = '动图暂时未能加载，可以点按重试。';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && playing) update(false);
  });
})();

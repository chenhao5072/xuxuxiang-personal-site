(() => {
  'use strict';
  const invitationText = [
    '良辰有约', '', '生辰之喜 · 敬邀赴宴', '',
    '古有良辰设宴，今有故友相聚。', '',
    '今逢许公旭祥生辰，择良日，设佳宴，邀诸位亲朋好友共赴此约。', '',
    '相识是缘，相聚是喜。愿借此良辰，与诸君把酒言欢，共叙情谊，不负相逢。', '',
    '宴启：2026年10月31日（星期六）晚八时', '',
    '敬候诸君，届时赴宴，共贺生辰！', '', '不见不散。', '', '—— 许公旭祥 敬邀',
  ].join('\n');
  const copy = document.querySelector('[data-copy-invitation]');
  const fallback = document.querySelector('.invitation-copy-fallback');
  const status = document.querySelector('.copy-status');
  let statusTimer;
  let copyTimer;
  const announce = message => {
    if (!status) return;
    clearTimeout(statusTimer);
    status.textContent = message;
    status.classList.add('is-visible');
    statusTimer = setTimeout(() => {
      status.classList.remove('is-visible');
      status.textContent = '';
    }, 4000);
  };
  copy?.addEventListener('click', async () => {
    clearTimeout(copyTimer);
    copy.disabled = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(invitationText);
      fallback.hidden = true;
      copy.textContent = '邀请函已复制';
      announce('完整邀请函已复制，可以发给朋友了。');
      copyTimer = setTimeout(() => { copy.textContent = '复制邀请函 ↗'; }, 2500);
    } catch {
      fallback.hidden = false;
      const field = fallback.querySelector('textarea');
      field.value = invitationText;
      field.focus();
      field.select();
      announce('已为你选中完整邀请函，可长按或使用快捷键复制。');
    } finally {
      copy.disabled = false;
    }
  });

  const canvas = document.querySelector('.birthday-fireworks');
  const trigger = document.querySelector('[data-celebrate]');
  const context = canvas?.getContext('2d');
  if (!canvas || !trigger || !context) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const palette = ['#c94335', '#e3a13d', '#f8d98e', '#2d6860', '#fff4df'];
  let frame = 0;
  let particles = [];
  let startedAt = 0;
  let lastTime = 0;
  let autoTimer = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    particles = [];
    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.classList.remove('is-active');
  };
  const render = now => {
    if (document.hidden || reducedMotion.matches || now - startedAt > 3200) {
      stop();
      return;
    }
    const elapsed = Math.min((now - lastTime) / 16.67, 2);
    lastTime = now;
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const particle of particles) {
      particle.x += particle.vx * elapsed;
      particle.y += particle.vy * elapsed;
      particle.vy += .105 * elapsed;
      particle.rotation += particle.spin * elapsed;
      context.save();
      context.translate(particle.x, particle.y);
      context.rotate(particle.rotation);
      context.globalAlpha = Math.max(0, Math.min(1, (3200 - (now - startedAt)) / 650));
      context.fillStyle = particle.color;
      context.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
      context.restore();
    }
    frame = requestAnimationFrame(render);
  };
  const celebrate = ({automatic = false} = {}) => {
    stop();
    clearTimeout(autoTimer);
    if (!automatic) announce('生日快乐，许旭祥！愿每一岁，都有热爱。');
    if (reducedMotion.matches || document.hidden) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    particles = Array.from({length: width < 760 ? 75 : 115}, (_, index) => {
      const fromLeft = index % 2 === 0;
      return {
        x: fromLeft ? -10 : width + 10,
        y: height * (.38 + Math.random() * .22),
        vx: (fromLeft ? 1 : -1) * (3 + Math.random() * 7),
        vy: -3 - Math.random() * 7,
        size: 5 + Math.random() * 6,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - .5) * .2,
        color: palette[index % palette.length],
      };
    });
    startedAt = lastTime = performance.now();
    canvas.classList.add('is-active');
    frame = requestAnimationFrame(render);
  };
  trigger.addEventListener('click', () => celebrate());
  window.addEventListener('resize', stop, {passive: true});
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  reducedMotion.addEventListener('change', () => { clearTimeout(autoTimer); stop(); });
  window.addEventListener('pagehide', () => { clearTimeout(autoTimer); stop(); });
  if (!reducedMotion.matches) autoTimer = setTimeout(() => celebrate({automatic: true}), 750);
})();

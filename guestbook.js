(() => {
  'use strict';

  const section = document.querySelector('#guestbook');
  if (!section) return;

  const get = selector => section.querySelector(selector);
  const form = get('[data-guestbook-form]');
  const nameField = get('#guestbook-name');
  const messageField = get('#guestbook-text');
  const websiteField = get('#guestbook-website');
  const submit = get('[data-guestbook-submit]');
  const submitLabel = get('[data-guestbook-submit-label]');
  const formStatus = get('[data-guestbook-form-status]');
  const lengthLabel = get('[data-guestbook-length]');
  const wall = get('.guestbook-wall');
  const stage = get('[data-guestbook-stage]');
  const empty = get('[data-guestbook-empty]');
  const emptyCopy = get('[data-guestbook-empty-copy]');
  const card = get('[data-guestbook-message]');
  const copy = get('[data-guestbook-copy]');
  const author = get('[data-guestbook-name]');
  const date = get('[data-guestbook-date]');
  const count = get('[data-guestbook-count]');
  const totalLabel = get('[data-guestbook-total]');
  const feedStatus = get('[data-guestbook-feed-status]');
  const retry = get('[data-guestbook-retry]');
  const previous = get('[data-guestbook-prev]');
  const next = get('[data-guestbook-next]');
  const play = get('[data-guestbook-play]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const charLength = value => Array.from(value).length;
  const apiPath = '/api/guestbook';
  const refreshInterval = 5000;
  const rotationInterval = 7000;

  let messages = [];
  let total = 0;
  let token = '';
  let index = 0;
  let nearViewport = false;
  let inViewport = false;
  let hasLoaded = false;
  let hovered = false;
  let focused = false;
  let userPaused = reducedMotion.matches;
  let busy = false;
  let blockedUntil = 0;
  let rotationTimer;
  let cooldownTimer;
  let inFlightRead = null;
  let lastRead = 0;
  let pendingSubmission = null;
  let readRevision = 0;
  let refreshQueued = false;

  const announce = (text, type = '') => {
    formStatus.textContent = text;
    formStatus.className = 'guestbook-form-status' + (type ? ` is-${type}` : '');
  };

  const setSubmitState = () => {
    const coolingDown = Date.now() < blockedUntil;
    submit.disabled = busy || coolingDown;
    submitLabel.textContent = busy ? '正在把话留下…' : coolingDown ? '稍后再试' : '把话留下';
    form.setAttribute('aria-busy', String(busy));
    nameField.readOnly = messageField.readOnly = busy;
  };

  const updateLength = () => {
    const length = charLength(messageField.value);
    lengthLabel.textContent = `${length} / 200`;
    lengthLabel.classList.toggle('is-over-limit', length > 200);
    messageField.setAttribute('aria-invalid', String(length > 200));
    nameField.setAttribute('aria-invalid', String(charLength(nameField.value.trim()) > 20));
  };

  const syncRotation = () => {
    clearInterval(rotationTimer);
    play.disabled = previous.disabled = next.disabled = messages.length < 2;
    play.textContent = userPaused ? '播放轮播' : '暂停轮播';
    play.setAttribute('aria-label', userPaused ? '开始自动轮播留言' : '暂停自动轮播留言');
    if (messages.length < 2 || userPaused || !inViewport || hovered || focused || document.hidden) return;
    rotationTimer = setInterval(() => showMessage(index + 1), rotationInterval);
  };

  const formatDate = raw => {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: '2-digit', day: '2-digit'}).format(parsed).replaceAll('/', '.');
  };

  const updateIndicators = () => {
    const message = messages[index];
    count.textContent = `${String(message ? index + 1 : 0).padStart(2, '0')} / ${String(messages.length).padStart(2, '0')}`;
    totalLabel.textContent = total > 0 ? `已经留下 ${total} 句问候` : '等待一声问候';
    if (message) card.setAttribute('aria-label', `第 ${index + 1} 条，共 ${messages.length} 条留言`);
  };

  const sameMessage = (first, second) => Boolean(first && second
    && first.id === second.id && first.name === second.name
    && first.message === second.message && first.createdAt === second.createdAt);

  const showMessage = (requestedIndex, animate = true) => {
    index = messages.length ? (requestedIndex + messages.length) % messages.length : 0;
    const message = messages[index];
    card.hidden = !message;
    empty.hidden = Boolean(message);
    updateIndicators();
    if (message) {
      const length = charLength(message.message);
      copy.textContent = message.message;
      copy.scrollTop = 0;
      copy.classList.toggle('is-long', length > 50);
      copy.classList.toggle('is-very-long', length > 110);
      author.textContent = `— ${message.name || '路过的朋友'}`;
      date.textContent = formatDate(message.createdAt);
      if (date.textContent) date.setAttribute('datetime', message.createdAt);
      else date.removeAttribute('datetime');
      card.classList.remove('is-entering');
      if (animate && !reducedMotion.matches) {
        void card.offsetWidth;
        card.classList.add('is-entering');
      }
    } else {
      emptyCopy.textContent = hasLoaded ? '说说近况，或只是打个招呼。你的留言，会在这里慢慢传递。' : '正在翻开留言簿…';
    }
    syncRotation();
  };

  const cleanMessage = value => {
    if (!value || typeof value.id !== 'string' || typeof value.message !== 'string' || !value.message.trim()) return null;
    return {
      id: value.id,
      name: typeof value.name === 'string' ? Array.from(value.name).slice(0, 20).join('') : '',
      message: Array.from(value.message).slice(0, 200).join(''),
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : ''
    };
  };

  const request = async (url, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {cache: 'no-store', credentials: 'same-origin', ...options, signal: controller.signal});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(typeof data.error === 'string' ? data.error : '暂时没有连上留言簿，请稍后再试。');
        error.code = data.code;
        error.status = response.status;
        const retryAfter = response.headers.get('Retry-After');
        const seconds = Number(retryAfter);
        error.retryAfter = Number.isFinite(seconds) && seconds > 0 ? seconds : Math.max(1, (Date.parse(retryAfter) - Date.now()) / 1000 || 60);
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('连接比平时慢一些，留言暂未确认，请稍后重试。');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  const loadMessages = ({force = false, quiet = false} = {}) => {
    if (inFlightRead) return inFlightRead;
    if (!force && Date.now() - lastRead < refreshInterval) return Promise.resolve();
    const revision = ++readRevision;
    if (!quiet) {
      feedStatus.textContent = '正在翻开留言簿…';
      retry.hidden = true;
    }
    inFlightRead = (async () => {
      try {
        const data = await request(apiPath);
        if (!Array.isArray(data.messages) || typeof data.token !== 'string') throw new Error('留言簿暂时没有正确回应，请稍后重试。');
        if (revision !== readRevision) return;
        token = data.token;
        lastRead = Date.now();
        const currentMessage = messages[index];
        const previousMessages = messages;
        const initialRead = !hasLoaded;
        const seen = new Set();
        messages = data.messages.map(cleanMessage).filter(message => message && !seen.has(message.id) && seen.add(message.id)).slice(0, 30);
        total = Number.isFinite(data.total) ? Math.max(data.total, messages.length) : messages.length;
        hasLoaded = true;
        feedStatus.textContent = messages.length ? '新朋友的问候，会在这里相遇。' : '';
        retry.hidden = true;
        const feedChanged = previousMessages.length !== messages.length
          || messages.some((message, position) => !sameMessage(message, previousMessages[position]));
        const retainedIndex = messages.findIndex(message => message.id === currentMessage?.id);
        const previousIds = new Set(previousMessages.map(message => message.id));
        const newIndex = messages.findIndex(message => !previousIds.has(message.id));
        const preservingReading = userPaused || hovered || focused;
        if (initialRead || (feedChanged && (retainedIndex < 0
          || !sameMessage(currentMessage, messages[retainedIndex])
          || (newIndex >= 0 && !preservingReading)))) {
          showMessage(newIndex >= 0 && !preservingReading ? newIndex : Math.max(0, retainedIndex), false);
        } else {
          // Polling must not restart the seven-second rotation or reset scroll while reading.
          index = Math.max(0, retainedIndex);
          updateIndicators();
          if ((previousMessages.length < 2) !== (messages.length < 2)) syncRotation();
        }
      } catch (error) {
        if (revision === readRevision) {
          feedStatus.textContent = messages.length ? '新留言暂未更新，仍可阅读已加载的问候。' : '暂时没能打开留言簿，请再试一次。';
          if (!messages.length) emptyCopy.textContent = '连接偶尔也需要歇一会儿。点击下方“重新加载”，再看看朋友们的问候。';
          retry.hidden = false;
        }
        throw error;
      } finally {
        inFlightRead = null;
      }
    })();
    return inFlightRead;
  };

  const refreshIfVisible = (force = false) => {
    if (!nearViewport || document.hidden || navigator.onLine === false) return;
    if (busy) {
      if (force) refreshQueued = true;
      return;
    }
    // Focus and visibility events often arrive together; one fresh read is enough.
    if (force && Date.now() - lastRead < 750) return;
    loadMessages({force, quiet: hasLoaded}).catch(() => {});
  };

  const newSubmissionId = () => {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = bytes[6] & 0x0f | 0x40;
    bytes[8] = bytes[8] & 0x3f | 0x80;
    return [...bytes].map((byte, position) => ([4, 6, 8, 10].includes(position) ? '-' : '') + byte.toString(16).padStart(2, '0')).join('');
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || Date.now() < blockedUntil) return;
    const name = nameField.value.trim();
    const message = messageField.value.trim();
    updateLength();
    if (charLength(name) > 20) {
      announce('称呼简短一点就好，最多 20 字。', 'error');
      nameField.focus();
      return;
    }
    if (!message || charLength(message) > 200) {
      messageField.setAttribute('aria-invalid', 'true');
      announce(message ? '这一句有点长，请控制在 200 字以内。' : '先写下一句想说的话吧。', 'error');
      messageField.focus();
      return;
    }

    const fingerprint = JSON.stringify({name, message});
    if (!pendingSubmission || pendingSubmission.fingerprint !== fingerprint) pendingSubmission = {fingerprint, id: newSubmissionId()};
    const submissionId = pendingSubmission.id;
    busy = true;
    setSubmitState();
    announce('正在把你的问候送到这里…');
    let attemptedWrite = false;
    try {
      if (!token) await loadMessages({force: true, quiet: true});
      const send = () => {
        attemptedWrite = true;
        return request(apiPath, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({name, message, website: websiteField.value, token, submissionId})
        });
      };
      let data;
      try {
        data = await send();
      } catch (error) {
        if (error.code !== 'TOKEN_EXPIRED') throw error;
        token = '';
        await loadMessages({force: true, quiet: true});
        data = await send();
      }
      const saved = cleanMessage(data.message);
      if (!saved) throw new Error('留言尚未得到确认，请重试一次；不会重复留下同一句话。');
      ++readRevision;
      messages = [saved, ...messages.filter(item => item.id !== saved.id)].slice(0, 30);
      total = Number.isFinite(data.total) ? Math.max(data.total, messages.length) : Math.max(total + 1, messages.length);
      hasLoaded = true;
      showMessage(0);
      stage.setAttribute('aria-live', 'polite');
      setTimeout(() => stage.removeAttribute('aria-live'), 2000);
      messageField.value = '';
      websiteField.value = '';
      pendingSubmission = null;
      updateLength();
      feedStatus.textContent = '新朋友的问候，会在这里相遇。';
      retry.hidden = true;
      announce('收到了，谢谢你的这一句。已经放进留言簿里。', 'success');
    } catch (error) {
      if (error.status === 429) {
        const wait = Math.min(Math.max(1, Math.ceil(error.retryAfter || 60)), 86400);
        blockedUntil = Date.now() + wait * 1000;
        clearTimeout(cooldownTimer);
        cooldownTimer = setTimeout(setSubmitState, wait * 1000 + 100);
        announce(error.message + ` 请约 ${wait < 60 ? `${wait} 秒` : `${Math.ceil(wait / 60)} 分钟`}后再试，文字已为你保留。`, 'error');
      } else {
        const description = error.status ? error.message : attemptedWrite ? '暂时没能确认留言是否送达。' : '暂时没有连上留言簿。';
        announce(description + ' 文字已为你保留，可以重试。', 'error');
      }
    } finally {
      busy = false;
      setSubmitState();
      if (refreshQueued) {
        refreshQueued = false;
        refreshIfVisible(true);
      }
    }
  });

  [nameField, messageField].forEach(field => field.addEventListener('input', () => {
    updateLength();
    if (formStatus.classList.contains('is-error') && Date.now() >= blockedUntil) announce('');
  }));
  previous.addEventListener('click', () => showMessage(index - 1));
  next.addEventListener('click', () => showMessage(index + 1));
  play.addEventListener('click', () => { userPaused = !userPaused; syncRotation(); });
  retry.addEventListener('click', () => loadMessages({force: true}).catch(() => {}));
  wall.addEventListener('mouseenter', () => { hovered = true; syncRotation(); });
  wall.addEventListener('mouseleave', () => { hovered = false; syncRotation(); });
  wall.addEventListener('focusin', () => {
    if (!focused) { focused = true; syncRotation(); }
  });
  wall.addEventListener('focusout', event => {
    const nextFocused = Boolean(event.relatedTarget && wall.contains(event.relatedTarget));
    if (focused !== nextFocused) { focused = nextFocused; syncRotation(); }
  });
  document.addEventListener('visibilitychange', () => { syncRotation(); refreshIfVisible(true); });
  window.addEventListener('focus', () => refreshIfVisible(true));
  window.addEventListener('online', () => refreshIfVisible(true));
  reducedMotion.addEventListener('change', event => { userPaused = event.matches; syncRotation(); });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      nearViewport = entries[0].isIntersecting;
      refreshIfVisible(true);
    }, {rootMargin: '450px 0px'}).observe(section);
    new IntersectionObserver(entries => {
      const visible = entries[0].isIntersecting;
      if (inViewport !== visible) { inViewport = visible; syncRotation(); }
    }, {threshold: .05}).observe(wall);
  } else {
    nearViewport = inViewport = true;
    refreshIfVisible();
  }
  setInterval(() => refreshIfVisible(true), refreshInterval);
  updateLength();
  setSubmitState();
})();

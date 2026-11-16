(() => {
  'use strict';

  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const scrollBehavior = () => motionPreference.matches ? 'auto' : 'smooth';
  const rail = document.querySelector('.photo-rail');
  const railButtons = [...document.querySelectorAll('[data-rail]')];
  const syncRail = () => {
    if (!rail) return;
    const maxScroll = Math.max(0, rail.scrollWidth - rail.clientWidth);
    railButtons.forEach(button => {
      button.disabled = Number(button.dataset.rail) < 0
        ? rail.scrollLeft <= 4
        : rail.scrollLeft >= maxScroll - 4;
    });
  };

  if (rail) {
    railButtons.forEach(button => button.addEventListener('click', () => {
      rail.scrollBy({left: Number(button.dataset.rail) * rail.clientWidth * .7, behavior: scrollBehavior()});
    }));
    rail.addEventListener('scroll', syncRail, {passive: true});
    window.addEventListener('resize', syncRail, {passive: true});
    if ('ResizeObserver' in window) new ResizeObserver(syncRail).observe(rail);
    syncRail();
  }

  document.querySelectorAll('a[href^="#"]').forEach(link => link.addEventListener('click', event => {
    const hash = link.getAttribute('href');
    const target = hash && document.getElementById(hash.slice(1));
    if (!target) return;
    event.preventDefault();
    const offset = parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0;
    window.scrollTo({top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset), behavior: scrollBehavior()});
    if (hash !== '#top') {
      const wasFocusable = target.hasAttribute('tabindex');
      if (!wasFocusable) target.setAttribute('tabindex', '-1');
      target.focus({preventScroll: true});
      if (!wasFocusable) target.addEventListener('blur', () => target.removeAttribute('tabindex'), {once: true});
    }
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
  }));

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());

  const copyStatus = document.querySelector('.copy-status');
  let statusTimer;
  const announceCopy = message => {
    if (!copyStatus) return;
    clearTimeout(statusTimer);
    copyStatus.textContent = message;
    copyStatus.classList.add('is-visible');
    statusTimer = setTimeout(() => {
      copyStatus.classList.remove('is-visible');
      copyStatus.textContent = '';
    }, 4000);
  };
  document.querySelectorAll('[data-copy]').forEach(button => {
    const action = button.querySelector('.copy-action');
    const originalAction = action.textContent;
    const fallback = button.parentElement.querySelector('.copy-fallback');
    let actionTimer;
    button.addEventListener('click', async () => {
      clearTimeout(actionTimer);
      button.disabled = true;
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(button.dataset.copy);
        fallback.hidden = true;
        action.textContent = '已复制';
        announceCopy(`${button.dataset.copyLabel}已复制`);
        actionTimer = setTimeout(() => { action.textContent = originalAction; }, 2500);
      } catch {
        action.textContent = '手动复制';
        fallback.hidden = false;
        const field = fallback.querySelector('input');
        field.focus();
        field.select();
        announceCopy('浏览器未允许自动复制，已为你选中账号，可手动复制。');
      } finally {
        button.disabled = false;
      }
    });
  });

  const qrButton = document.querySelector('[data-wechat-qr]');
  const qrDialog = document.querySelector('#wechat-dialog');
  if (qrButton && qrDialog) {
    const qrClose = qrDialog.querySelector('.wechat-dialog-close');
    let qrPreviousOverflow = '';
    qrButton.addEventListener('click', () => {
      if (typeof qrDialog.showModal !== 'function') {
        window.location.assign(qrButton.querySelector('img').src);
        return;
      }
      qrPreviousOverflow = document.body.style.overflow;
      qrDialog.showModal();
      document.body.style.overflow = 'hidden';
      qrClose.focus();
    });
    qrClose.addEventListener('click', () => qrDialog.close());
    qrDialog.addEventListener('close', () => {
      document.body.style.overflow = qrPreviousOverflow;
      qrButton.focus({preventScroll: true});
    });
    qrDialog.addEventListener('click', event => {
      if (event.target !== qrDialog) return;
      const bounds = qrDialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) qrDialog.close();
    });
  }

  const photoButtons = [...document.querySelectorAll('[data-photo]')];
  photoButtons.forEach(button => {
    const image = button.querySelector('img');
    if (!image) return;
    const showFallback = () => {
      button.classList.add('has-image-error');
      if (!button.querySelector('.photo-placeholder')) {
        const placeholder = document.createElement('span');
        placeholder.className = 'photo-placeholder';
        placeholder.textContent = '影像暂时未能加载';
        placeholder.setAttribute('aria-hidden', 'true');
        button.append(placeholder);
      }
    };
    image.addEventListener('error', showFallback);
    if (image.complete && image.naturalWidth === 0) showFallback();
    image.addEventListener('load', syncRail, {once: true});
  });

  const dialog = document.querySelector('.photo-dialog');
  document.body.dataset.ready = 'true';
  if (!dialog || typeof dialog.showModal !== 'function') {
    photoButtons.forEach(button => button.addEventListener('click', () => {
      const image = button.querySelector('img');
      if (image) window.location.assign(image.currentSrc || image.src);
    }));
    return;
  }

  const enlargedImage = dialog.querySelector('.lightbox-image');
  const photoTitle = dialog.querySelector('#photo-dialog-title');
  const counter = dialog.querySelector('.lightbox-counter');
  const errorMessage = dialog.querySelector('.lightbox-error');
  const closeButton = dialog.querySelector('.lightbox-close');
  const prevButton = dialog.querySelector('.lightbox-prev');
  const nextButton = dialog.querySelector('.lightbox-next');
  let currentIndex = 0;
  let returnFocus = null;
  let previousBodyOverflow = '';

  const displayPhoto = index => {
    currentIndex = (index + photoButtons.length) % photoButtons.length;
    const button = photoButtons[currentIndex];
    const image = button.querySelector('img');
    errorMessage.hidden = true;
    enlargedImage.hidden = true;
    enlargedImage.alt = image.alt;
    photoTitle.textContent = button.dataset.title || image.alt;
    counter.textContent = String(currentIndex + 1) + ' / ' + String(photoButtons.length);
    enlargedImage.src = image.currentSrc || image.src;
    if (enlargedImage.complete && enlargedImage.naturalWidth > 0) enlargedImage.hidden = false;
    prevButton.disabled = nextButton.disabled = photoButtons.length < 2;
  };

  enlargedImage.addEventListener('load', () => {
    enlargedImage.hidden = false;
    errorMessage.hidden = true;
  });
  enlargedImage.addEventListener('error', () => {
    enlargedImage.hidden = true;
    errorMessage.hidden = false;
  });

  photoButtons.forEach((button, index) => button.addEventListener('click', () => {
    returnFocus = button;
    displayPhoto(index);
    previousBodyOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    closeButton.focus();
  }));
  closeButton.addEventListener('click', () => dialog.close());
  prevButton.addEventListener('click', () => displayPhoto(currentIndex - 1));
  nextButton.addEventListener('click', () => displayPhoto(currentIndex + 1));
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      displayPhoto(currentIndex + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  dialog.addEventListener('close', () => {
    document.body.style.overflow = previousBodyOverflow;
    if (returnFocus && returnFocus.isConnected) returnFocus.focus({preventScroll: true});
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog) dialog.close();
  });

  // The page is visible before JavaScript runs; never wait on offscreen, lazy images.
  document.body.dataset.ready = 'true';
})();

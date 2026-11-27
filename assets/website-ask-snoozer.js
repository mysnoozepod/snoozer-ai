(() => {
  const panel = document.getElementById('WebsiteAskSnoozer');
  if (!panel || typeof panel.showModal !== 'function') return;

  const triggerSelector = '[data-website-snoozer-trigger]';
  const mobile = window.matchMedia('(max-width: 989px)');
  const closeButton = panel.querySelector('[data-website-snoozer-close]');
  const form = panel.querySelector('[data-website-snoozer-form]');
  const input = panel.querySelector('[data-website-snoozer-input]');
  const sendButton = panel.querySelector('[data-website-snoozer-send]');
  const welcome = panel.querySelector('[data-website-snoozer-welcome]');
  const log = panel.querySelector('[data-website-snoozer-conversation]');
  const scroller = panel.querySelector('[data-website-snoozer-scroll]');
  const status = panel.querySelector('[data-website-snoozer-status]');

  const storageKey = 'mysnoozepod:website-ask-snoozer:v1';
  const sessionFormat = /^website_[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
  const sessionDurationMs = 30 * 60 * 1000;
  const maxTurns = 20;
  const productPath = /^\/products\/[a-z0-9][a-z0-9-]*(?:\?variant=[1-9][0-9]*)?$/;
  const systemPath = /^\/pages\/sleep-systems(?:\?system=(?:standard|split_head|full_split)#sleep-systems)?$/;
  const bookingPath = '/pages/book-a-snooze-session';
  const state = readStorage();
  let opener;
  let parkedScroll;
  let pending = false;
  let layoutFrame = 0;
  let observedPreviewBar;
  const previewBarResize = new ResizeObserver(scheduleLayout);

  function text(value, limit) {
    return typeof value === 'string' ? value.trim().slice(0, limit) : '';
  }

  function validLinks(entries) {
    const links = new Map();
    for (const entry of Array.isArray(entries) ? entries : []) {
      const target = typeof entry?.target === 'string' ? entry.target : '';
      const label = text(entry?.label, 128);
      if (label && (target === bookingPath || systemPath.test(target) || productPath.test(target)) && !links.has(target)) {
        links.set(target, { target, label });
      }
    }
    return [...links.values()].slice(0, 4);
  }

  function readStorage() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey));
      if (saved && Number.isFinite(saved.savedAt) && Date.now() - saved.savedAt < sessionDurationMs) {
        return {
          sessionId: sessionFormat.test(saved.sessionId) ? saved.sessionId : '',
          savedAt: saved.savedAt,
          draft: text(saved.draft, 1000),
          turns: (Array.isArray(saved.turns) ? saved.turns : []).slice(-maxTurns).flatMap((turn) => {
            const question = text(turn?.question, 1000);
            const reply = text(turn?.reply, 2000);
            return question && reply ? [{ question, reply, links: validLinks(turn.links) }] : [];
          }),
        };
      }
      sessionStorage.removeItem(storageKey);
    } catch {
      // The chat still works for this page when browser storage is unavailable.
    }
    return { sessionId: '', savedAt: 0, draft: '', turns: [] };
  }

  function saveStorage() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // A blocked or full store must not interrupt the active chat.
    }
  }

  function updateDraft() {
    state.draft = input.value;
    if (!state.sessionId && state.draft) state.savedAt = Date.now();
    saveStorage();
  }

  function appendMessage(from, message, links = []) {
    const bubble = document.createElement('div');
    bubble.className = `website-snoozer__turn website-snoozer__turn--${from}`;
    const speaker = document.createElement('span');
    speaker.className = 'visually-hidden';
    speaker.textContent = from === 'shopper' ? 'You: ' : 'Snoozer: ';
    const copy = document.createElement('p');
    copy.append(speaker, document.createTextNode(message));
    bubble.append(copy);
    if (links.length) {
      const group = document.createElement('div');
      group.className = 'website-snoozer__links';
      for (const { label, target } of links) {
        const link = document.createElement('a');
        link.href = target;
        link.textContent = label;
        group.append(link);
      }
      bubble.append(group);
    }
    log.append(bubble);
    return bubble;
  }

  function setStatus(message, error = false) {
    status.toggleAttribute('data-error', error);
    status.textContent = message;
  }

  function scrollToLatest() {
    if (panel.open) scroller.scrollTop = scroller.scrollHeight;
  }

  function refreshTriggers() {
    for (const trigger of document.querySelectorAll(triggerSelector)) {
      trigger.hidden = false;
      trigger.setAttribute('aria-expanded', String(panel.open));
    }
  }

  function updateLayout() {
    if (!panel.open) return;
    const viewport = mobile.matches ? window.visualViewport : null;
    const top = viewport?.offsetTop || 0;
    const height = viewport?.height || window.innerHeight;
    const bottom = top + height;
    // Shopify mounts its preview toolbar as a top-layer popover above the theme.
    const previewBar = document.getElementById('PBarNextFrameWrapper');
    if (previewBar !== observedPreviewBar) {
      previewBarResize.disconnect();
      if (previewBar) previewBarResize.observe(previewBar);
      observedPreviewBar = previewBar;
    }
    const bar = previewBar?.getBoundingClientRect();
    const bottomInset = bar?.height > 0 && bar.top > top && bar.top < bottom && bar.bottom >= bottom - 2
      ? Math.ceil(bottom - bar.top)
      : 0;
    panel.style.setProperty('--website-snoozer-bottom-inset', `${bottomInset}px`);
    if (mobile.matches) {
      panel.style.setProperty('--website-snoozer-viewport-top', `${top}px`);
      panel.style.setProperty('--website-snoozer-viewport-height', `${height}px`);
    } else {
      const header = document.querySelector('.section-header .header-wrapper');
      const bottom = header?.getBoundingClientRect().bottom || 0;
      panel.style.setProperty('--website-snoozer-top', `${Math.max(0, Math.round(bottom))}px`);
    }
  }

  function scheduleLayout() {
    if (!panel.open || layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      updateLayout();
    });
  }

  function restoreBackgroundScroll() {
    if (!parkedScroll) return;
    window.scrollTo({ top: parkedScroll.y, left: parkedScroll.x, behavior: 'instant' });
    parkedScroll = undefined;
  }

  function showPanel() {
    if (mobile.matches) {
      parkedScroll = { x: window.scrollX, y: window.scrollY };
      document.body.classList.add('website-snoozer-modal');
      panel.showModal();
    } else {
      document.body.classList.add('website-snoozer-docked');
      panel.show();
    }
    updateLayout();
    scrollToLatest();
  }

  function resetPresentation() {
    panel.close();
    document.body.classList.remove('website-snoozer-docked', 'website-snoozer-modal');
    restoreBackgroundScroll();
  }

  function closePanel() {
    if (!panel.open) return;
    resetPresentation();
    refreshTriggers();
    const returnFocus = opener?.isConnected ? opener : document.querySelector(triggerSelector);
    returnFocus?.focus({ preventScroll: true });
  }

  function openPanel(trigger) {
    if (panel.open) return;
    opener = trigger;
    showPanel();
    refreshTriggers();
    closeButton.focus({ preventScroll: true });
  }

  function currentPage() {
    return {
      pageType: panel.dataset.pageType || '',
      route: window.location.pathname,
      productHandle: panel.dataset.productHandle || '',
    };
  }

  function conversationEndpoint() {
    const base = window.MySnoozePod?.apiBase;
    if (!base) throw new Error('Ask Snoozer endpoint unavailable');
    const url = new URL(`${base.replace(/\/+$/, '')}/ask-snoozer`, window.location.origin);
    if (url.protocol !== 'https:' && url.origin !== window.location.origin) throw new Error('Invalid Ask Snoozer endpoint');
    return url.href;
  }

  async function submit(questionValue) {
    const question = text(questionValue, 1000);
    if (pending || !question) return;
    pending = true;
    sendButton.disabled = true;
    input.readOnly = true;
    input.value = question;
    if (!state.sessionId && typeof window.crypto?.randomUUID === 'function') {
      state.sessionId = `website_${window.crypto.randomUUID()}`;
      state.savedAt = Date.now();
    }
    updateDraft();
    welcome.hidden = true;
    const shopperBubble = appendMessage('shopper', question);
    setStatus('Snoozer is thinking…');
    scrollToLatest();

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 55000);
    try {
      const response = await fetch(conversationEndpoint(), {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'website', sessionId: state.sessionId || undefined, message: question, page: currentPage() }),
        signal: controller.signal,
      });
      const data = await response.json();
      const reply = text(data?.reply, 2000);
      if (
        !response.ok || data?.ok !== true || data.status !== 'answered' ||
        data.metadata?.answerSourceKey !== 'website-assessment.v1' || !sessionFormat.test(data.sessionId) || !reply
      ) {
        throw new Error('Ask Snoozer did not return an answer');
      }
      const actions = Array.isArray(data.actions) ? data.actions.filter((action) => action?.type === 'navigate') : [];
      const products = Array.isArray(data.products) ? data.products.map((product) => ({
        target: product?.url,
        label: product?.title ? `View ${product.title}` : '',
      })) : [];
      const links = validLinks([...actions, ...products]);
      state.sessionId = data.sessionId;
      state.savedAt = Date.now();
      state.turns = [...state.turns, { question, reply, links }].slice(-maxTurns);
      input.value = '';
      appendMessage('snoozer', reply, links);
      while (log.childElementCount > maxTurns * 2) log.firstElementChild.remove();
      setStatus('');
    } catch {
      shopperBubble.remove();
      welcome.hidden = state.turns.length > 0;
      setStatus('Snoozer couldn’t answer just now. Your question is still here. Try again when you’re ready.', true);
    } finally {
      window.clearTimeout(timer);
      pending = false;
      sendButton.disabled = false;
      input.readOnly = false;
      updateDraft();
      scrollToLatest();
    }
  }

  for (const turn of state.turns) {
    appendMessage('shopper', turn.question);
    appendMessage('snoozer', turn.reply, turn.links);
  }
  welcome.hidden = state.turns.length > 0;
  input.value = state.draft;
  refreshTriggers();

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest(`${triggerSelector}, [data-snoozer-trigger]`);
    if (!trigger) return;
    event.preventDefault();
    if (panel.open && trigger === opener) closePanel();
    else openPanel(trigger);
  });
  document.addEventListener('shopify:section:load', refreshTriggers);
  closeButton.addEventListener('click', closePanel);
  panel.addEventListener('cancel', (event) => {
    event.preventDefault();
    closePanel();
  });
  panel.addEventListener('keydown', (event) => {
    if (!mobile.matches && event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      closePanel();
    }
  });
  welcome.addEventListener('click', (event) => {
    const starter = event.target.closest('[data-website-snoozer-starter]');
    if (!starter) return;
    if (starter.dataset.websiteSnoozerStarter === 'assessment') {
      // This starter is a shopper request. It opens the same free-form conversation.
      if (input.value.trim() && !pending) {
        input.focus({ preventScroll: true });
        return;
      }
      closeButton.focus({ preventScroll: true });
      void submit('Help me find my sleep setup.');
    } else {
      input.focus({ preventScroll: true });
    }
  });
  input.addEventListener('input', updateDraft);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit(input.value);
  });
  mobile.addEventListener('change', () => {
    if (!panel.open) return;
    const active = document.activeElement;
    resetPresentation();
    showPanel();
    if (panel.contains(active)) active.focus({ preventScroll: true });
  });
  window.addEventListener('scroll', scheduleLayout, { passive: true });
  window.addEventListener('resize', scheduleLayout);
  window.visualViewport?.addEventListener('resize', scheduleLayout);
  window.visualViewport?.addEventListener('scroll', scheduleLayout);
  new MutationObserver(scheduleLayout).observe(document.body, { childList: true });
})();

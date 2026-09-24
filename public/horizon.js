(() => {
  const toggle = document.querySelector('#menu-toggle');
  const menu = document.querySelector('#mobile-menu');
  function setMenu(open) {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? '关闭导航' : '打开导航');
  }
  toggle.addEventListener('click', () => setMenu(menu.hidden));
  menu.addEventListener('click', event => { if (event.target.closest('a')) setMenu(false); });
  document.addEventListener('click', event => {
    if (!menu.hidden && !event.target.closest('.site-header')) setMenu(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { setMenu(false); toggle.focus(); }
  });
  window.matchMedia('(min-width:851px)').addEventListener('change', event => { if (event.matches) setMenu(false); });
  document.querySelectorAll('[data-icon]').forEach(image => {
    const project = window.PORTFOLIO.projects.find(project => project.id === image.dataset.icon);
    if (project?.icon) image.src = project.icon;
  });

  const pageMenu = document.querySelector('#page-context-menu');
  const hero = document.querySelector('.hero');
  const dialog = document.querySelector('#project-dialog');
  const motion = document.querySelector('#motion-toggle');
  const quality = document.querySelector('#render-quality');
  const reset = document.querySelector('#orbit-reset');
  const pageItems = [...pageMenu.querySelectorAll('[role="menuitem"]')];
  let returnFocus = null;

  function closePageMenu(restoreFocus = false) {
    if (pageMenu.hidden) return;
    pageMenu.hidden = true;
    if (restoreFocus && returnFocus?.isConnected && !returnFocus.closest('[inert]')) {
      returnFocus.focus({ preventScroll: true });
    }
    returnFocus = null;
  }
  function focusItem(item) {
    pageItems.forEach(button => { button.tabIndex = button === item ? 0 : -1; });
    item.focus({ preventScroll: true });
  }
  function revealHero() {
    if (dialog.open) document.querySelector('#close-dialog').click();
    if (!hero.classList.contains('is-exploring')) window.scrollTo({ top: 0, behavior: 'instant' });
  }
  document.addEventListener('contextmenu', event => {
    const target = event.target instanceof Element ? event.target : document.body;
    if (!pageMenu.hidden && pageMenu.contains(target) && !event.shiftKey) {
      event.preventDefault();
      return;
    }
    closePageMenu();
    // Keep browser copy/save/open actions on content, and an explicit native-menu escape hatch.
    if (event.defaultPrevented || event.shiftKey || target.isContentEditable
      || target.closest('a, img, picture, video, audio, input, textarea, select')
      || window.getSelection()?.toString().trim()) return;
    event.preventDefault();
    returnFocus = document.activeElement;
    const host = dialog.open ? dialog : hero.classList.contains('is-exploring') ? hero : document.body;
    host.append(pageMenu);
    pageMenu.inert = false;
    delete pageMenu.dataset.orbitInert;
    for (const [action, control] of [['motion', motion], ['quality', quality], ['reset', reset]]) {
      pageMenu.querySelector(`[data-page-action="${action}"]`).disabled = control.disabled;
    }
    const paused = motion.getAttribute('aria-pressed') === 'true';
    const motionItem = pageMenu.querySelector('[data-page-action="motion"]');
    motionItem.querySelector('span').textContent = paused ? '继续动态' : '暂停动态';
    motionItem.querySelector('path').setAttribute('d', paused ? 'M8 5v14l11-7Z' : 'M8 5v14M16 5v14');
    pageMenu.hidden = false;
    pageMenu.style.left = '0px';
    pageMenu.style.top = '0px';
    const anchor = target.getBoundingClientRect();
    const keyboard = event.clientX === 0 && event.clientY === 0;
    const x = keyboard ? anchor.left + Math.min(24, anchor.width / 2) : event.clientX;
    const y = keyboard ? anchor.top + Math.min(24, anchor.height / 2) : event.clientY;
    const box = pageMenu.getBoundingClientRect();
    pageMenu.style.left = `${Math.max(8, Math.min(x, innerWidth - box.width - 8))}px`;
    pageMenu.style.top = `${Math.max(8, Math.min(y, innerHeight - box.height - 8))}px`;
    focusItem(pageItems[0]);
  });
  pageMenu.addEventListener('click', event => {
    const item = event.target.closest('[data-page-action]');
    if (!item || item.disabled) return;
    closePageMenu(true);
    switch (item.dataset.pageAction) {
      case 'refresh': window.location.reload(); break;
      case 'top':
        revealHero();
        if (hero.classList.contains('is-exploring')) document.querySelector('#explore-hole').click();
        window.scrollTo({ top: 0, behavior: 'instant' });
        document.querySelector('.brand').focus({ preventScroll: true });
        break;
      case 'quality': revealHero(); quality.focus(); break;
      case 'motion': motion.click(); break;
      case 'reset': revealHero(); reset.click(); reset.focus({ preventScroll: true }); break;
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!pageMenu.contains(event.target)) closePageMenu();
  }, true);
  document.addEventListener('keydown', event => {
    if (pageMenu.hidden) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closePageMenu(true);
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const items = pageItems.filter(item => !item.disabled);
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      focusItem(items[next]);
    }
  }, true);
  document.addEventListener('scroll', event => {
    if (!pageMenu.contains(event.target)) closePageMenu();
  }, true);
  document.addEventListener('portfolio:project-opening', () => closePageMenu(true));
  dialog.addEventListener('close', () => closePageMenu());
  new MutationObserver(() => closePageMenu()).observe(hero, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', () => closePageMenu());
  window.addEventListener('blur', () => closePageMenu());
})();

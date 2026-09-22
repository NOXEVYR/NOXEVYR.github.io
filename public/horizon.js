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
  const refresh = pageMenu.querySelector('button');
  let returnFocus = null;
  function closePageMenu(restoreFocus = false) {
    if (pageMenu.hidden) return;
    pageMenu.hidden = true;
    if (restoreFocus && returnFocus?.isConnected && !returnFocus.closest('[inert]')) {
      returnFocus.focus({preventScroll:true});
    }
    returnFocus = null;
  }
  document.addEventListener('contextmenu', event => {
    closePageMenu();
    const target = event.target instanceof Element ? event.target : document.body;
    // Preserve copy/open/save/edit actions and provide Shift+right-click as an escape hatch.
    if (event.defaultPrevented || event.shiftKey || target.isContentEditable
      || target.closest('a, img, picture, video, audio, input, textarea, select')
      || window.getSelection()?.toString().trim()) return;
    event.preventDefault();
    returnFocus = document.activeElement;
    const host = document.querySelector('#project-dialog[open]')
      || document.querySelector('.hero.is-exploring') || document.body;
    host.append(pageMenu);
    // Exploration makes unrelated body children inert. Only release our own menu.
    pageMenu.inert = false;delete pageMenu.dataset.orbitInert;
    pageMenu.hidden = false;
    pageMenu.style.left = '0px';pageMenu.style.top = '0px';
    const anchor = target.getBoundingClientRect();
    const keyboard = event.clientX === 0 && event.clientY === 0;
    const x = keyboard ? anchor.left + Math.min(24,anchor.width / 2) : event.clientX;
    const y = keyboard ? anchor.top + Math.min(24,anchor.height / 2) : event.clientY;
    const box = pageMenu.getBoundingClientRect();
    pageMenu.style.left = `${Math.max(8,Math.min(x,innerWidth-box.width-8))}px`;
    pageMenu.style.top = `${Math.max(8,Math.min(y,innerHeight-box.height-8))}px`;
    refresh.focus({preventScroll:true});
  });
  refresh.addEventListener('click', () => { closePageMenu();location.reload(); });
  document.addEventListener('pointerdown', event => {
    if (!pageMenu.contains(event.target)) closePageMenu();
  }, true);
  document.addEventListener('keydown', event => {
    if (pageMenu.hidden) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();event.stopImmediatePropagation();closePageMenu(true);
    } else if (['ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
      event.preventDefault();event.stopImmediatePropagation();refresh.focus();
    }
  }, true);
  document.addEventListener('scroll', () => closePageMenu(), true);
  document.addEventListener('portfolio:project-opening', () => closePageMenu(true));
  document.querySelector('#project-dialog').addEventListener('close', () => closePageMenu());
  new MutationObserver(() => closePageMenu()).observe(document.querySelector('.hero'),{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize', () => closePageMenu());
  window.addEventListener('blur', () => closePageMenu());
})();

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
})();

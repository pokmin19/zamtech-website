(() => {
  const panel = document.querySelector('.service-progress');
  const close = document.querySelector('.service-progress__close');
  if (!panel || !close) return;
  const open = () => { panel.classList.add('is-open'); panel.setAttribute('aria-hidden', 'false'); close.focus(); };
  const hide = () => { panel.classList.remove('is-open'); panel.setAttribute('aria-hidden', 'true'); };
  document.querySelectorAll('.service-trigger').forEach((button) => button.addEventListener('click', open));
  close.addEventListener('click', hide);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); });
})();

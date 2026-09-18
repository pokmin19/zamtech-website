(() => {
  const trigger = document.querySelector('.whatsapp');
  const selector = document.querySelector('.whatsapp-selector');
  const close = document.querySelector('.whatsapp-selector-close');
  if (!trigger || !selector || !close) return;
  const hide = () => { selector.classList.remove('is-open'); selector.setAttribute('aria-hidden', 'true'); trigger.setAttribute('aria-expanded', 'false'); };
  const show = () => { selector.classList.add('is-open'); selector.setAttribute('aria-hidden', 'false'); trigger.setAttribute('aria-expanded', 'true'); close.focus(); };
  trigger.addEventListener('click', () => selector.classList.contains('is-open') ? hide() : show());
  close.addEventListener('click', hide);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  document.addEventListener('click', event => { if (!selector.contains(event.target) && event.target !== trigger) hide(); });
})();

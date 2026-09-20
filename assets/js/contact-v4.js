(() => {
  const trigger = document.querySelector('.contact-whatsapp-trigger');
  const globalTrigger = document.querySelector('.whatsapp');
  if (trigger && globalTrigger) trigger.addEventListener('click', event => {
    event.stopPropagation();
    globalTrigger.click();
  });
})();

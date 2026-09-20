(() => {
  const messages = {
    default: `Hello ZAMTECH, I would like to make an enquiry regarding your products, services or project support.

Name:
Company:
Email:
Enquiry Type:
Product / Service:
Project / Location:
Requirement / Message:

Thank you.`,
    products: `Hello ZAMTECH, I would like to enquire about your products and solutions.

Name:
Company:
Email:
Product / Equipment:
Quantity:
Project / Location:
Requirement / Message:

Thank you.`,
    services: `Hello ZAMTECH, I would like to enquire about your services and technical support.

Name:
Company:
Email:
Service Required:
Project / Location:
Requirement / Message:

Thank you.`,
    industries: `Hello ZAMTECH, I would like to enquire about your industry capabilities and solutions.

Name:
Company:
Email:
Requirement / Message:

Thank you.`,
    projects: `Hello ZAMTECH, I would like to enquire about your projects and project support capabilities.

Name:
Company:
Email:
Project / Location:
Requirement / Message:

Thank you.`,
    partners: `Hello ZAMTECH, I would like to enquire about your principals, partners or collaboration opportunities.

Name:
Company:
Email:
Organisation:
Requirement / Message:

Thank you.`
  };

  const pageContext = () => {
    const body = document.body;
    if (body.classList.contains('products-v3')) return 'products';
    if (body.classList.contains('services-page')) return 'services';
    const progressTitle = document.querySelector('.zam-page-progress h1')?.textContent?.trim().toLowerCase();
    return ['industries', 'projects', 'partners'].includes(progressTitle) ? progressTitle : 'default';
  };
  const buildUrl = (number, context = pageContext()) => `https://wa.me/${number}?text=${encodeURIComponent(messages[context] || messages.default)}`;
  window.ZamtechWhatsApp = { messages, pageContext, buildUrl };

  const trigger = document.querySelector('.whatsapp');
  const selector = document.querySelector('.whatsapp-selector');
  const close = document.querySelector('.whatsapp-selector-close');
  if (trigger && selector && close) {
    selector.querySelectorAll('.whatsapp-selector-row a').forEach(link => {
      const number = link.href.includes('60105512203') ? '60105512203' : '60123343476';
      const displayNumber = number === '60105512203' ? '+60 10-551 2203' : '+60 12-334 3476';
      link.href = buildUrl(number);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', `Chat with ZAMTECH on WhatsApp at ${displayNumber}`);
    });
    const hide = () => { selector.classList.remove('is-open'); selector.setAttribute('aria-hidden', 'true'); trigger.setAttribute('aria-expanded', 'false'); };
    const show = () => { selector.classList.add('is-open'); selector.setAttribute('aria-hidden', 'false'); trigger.setAttribute('aria-expanded', 'true'); close.focus(); };
    trigger.addEventListener('click', () => selector.classList.contains('is-open') ? hide() : show());
    close.addEventListener('click', hide);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    document.addEventListener('click', event => { if (!selector.contains(event.target) && event.target !== trigger) hide(); });
  }
  document.dispatchEvent(new Event('zamtech-whatsapp-ready'));
})();

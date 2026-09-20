(() => {
  const form = document.querySelector('[data-contact-form]');
  if (!form) return;

  const submit = form.querySelector('.contact-submit');
  const status = form.querySelector('.contact-form-status');
  const widget = form.querySelector('#contact-turnstile');
  const fileInput = form.querySelector('input[type="file"]');
  const originalLabel = submit.dataset.submitLabel || 'Send Enquiry';
  const maxFileBytes = 3 * 1024 * 1024;
  const allowedTypes = new Set([
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg', 'image/png'
  ]);
  const allowedExtensions = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png']);
  let token = '';
  let widgetId = null;
  let submitting = false;

  const setStatus = (message, kind = '') => {
    status.hidden = !message;
    status.textContent = message;
    status.className = `contact-form-status${kind ? ` is-${kind}` : ''}`;
  };
  const setSubmitEnabled = enabled => {
    submit.disabled = !enabled || submitting;
    submit.setAttribute('aria-disabled', String(submit.disabled));
  };
  const setSubmitting = active => {
    submitting = active;
    submit.innerHTML = active ? 'Sending...' : `${originalLabel} <b>→</b>`;
    setSubmitEnabled(Boolean(token));
  };
  const resetVerification = () => {
    token = '';
    setSubmitEnabled(false);
    if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId);
  };
  const loadTurnstile = () => new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  const fileIsAllowed = file => {
    const extension = file.name.split('.').pop().toLowerCase();
    return allowedExtensions.has(extension) && allowedTypes.has(file.type);
  };
  const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });

  fetch('/api/contact-config', { headers: { Accept: 'application/json' } })
    .then(response => response.ok ? response.json() : Promise.reject())
    .then(({ siteKey }) => {
      if (!siteKey) throw new Error('missing site key');
      return loadTurnstile().then(() => {
        widgetId = window.turnstile.render(widget, {
          sitekey: siteKey,
          theme: 'light',
          action: 'contact',
          callback: value => { token = value; setStatus(''); setSubmitEnabled(true); },
          'expired-callback': () => { token = ''; setSubmitEnabled(false); setStatus('Verification expired. Please complete the verification again.', 'error'); },
          'error-callback': () => { token = ''; setSubmitEnabled(false); setStatus('Human verification failed. Please try again.', 'error'); }
        });
      });
    })
    .catch(() => {
      setStatus('Human verification is currently unavailable. Please contact us directly.', 'error');
      setSubmitEnabled(false);
    });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > maxFileBytes) {
      fileInput.value = '';
      setStatus('The selected attachment is too large. Please upload a file within the allowed size limit.', 'error');
    } else if (!fileIsAllowed(file)) {
      fileInput.value = '';
      setStatus('This attachment type is not allowed. Please choose a PDF, Office document, JPG or PNG file.', 'error');
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    if (!form.checkValidity()) {
      form.reportValidity();
      setStatus('Please complete all required fields and try again.', 'error');
      return;
    }
    if (!token) {
      setStatus('Please complete the human verification and try again.', 'error');
      return;
    }
    const file = fileInput.files[0];
    if (file && (file.size > maxFileBytes || !fileIsAllowed(file))) {
      setStatus(file.size > maxFileBytes ? 'The selected attachment is too large. Please upload a file within the allowed size limit.' : 'This attachment type is not allowed. Please choose a PDF, Office document, JPG or PNG file.', 'error');
      return;
    }
    setSubmitting(true);
    setStatus('');
    try {
      const data = new FormData(form);
      const payload = {
        name: data.get('Name'), company: data.get('Company'), email: data.get('Email'), phone: data.get('Phone'),
        enquiryType: data.get('Enquiry Type'), productService: data.get('Product / Service'), quantity: data.get('Quantity'),
        projectLocation: data.get('Project / Location'), requiredDeliveryDate: data.get('Required Delivery Date'),
        message: data.get('Message / Detailed Scope'), website: data.get('website'), turnstileToken: token,
        attachment: file ? { name: file.name, type: file.type, size: file.size, content: await toBase64(file) } : null
      };
      const response = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(result.message || 'We couldn\'t submit your enquiry right now. Please try again or contact us directly.', 'error');
        if (result.code === 'TURNSTILE_FAILED' || result.code === 'TURNSTILE_EXPIRED') resetVerification();
        return;
      }
      form.reset();
      resetVerification();
      setStatus('Thank you. Your enquiry has been submitted successfully. Our team will contact you regarding your requirement.', 'success');
    } catch {
      setStatus('We couldn\'t submit your enquiry right now. Please try again or contact us directly.', 'error');
    } finally {
      setSubmitting(false);
    }
  });
})();

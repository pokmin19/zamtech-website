const crypto = require('crypto');
const yauzl = require('yauzl');

const INTERNAL_RECIPIENT = 'info@zamtechsdnbhd.com';
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;
const MAX_ZIP_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const WINDOW_SECONDS = 15 * 60;
const MAX_SUBMISSIONS = 5;
const ENQUIRY_TYPES = new Set(['General Enquiry', 'Product Enquiry', 'Service Enquiry', 'Request a Quotation', 'Technical Support']);
const FILE_TYPES = {
  pdf: ['application/pdf'], doc: ['application/msword'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  jpg: ['image/jpeg'], jpeg: ['image/jpeg'], png: ['image/png']
};

const fail = (res, status, code, message) => res.status(status).json({ code, message });
const clean = (value, max = 1000) => typeof value === 'string' ? value.trim().replace(/\u0000/g, '').slice(0, max) : '';
const headerSafe = value => !/[\r\n]/.test(value);
const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const textLine = (label, value) => `${label}: ${value || '—'}`;

function readJson(req) {
  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > MAX_BODY_BYTES) return Promise.reject(new Error('BODY_TOO_LARGE'));
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    req.on('data', chunk => { total += chunk.length; if (total > MAX_BODY_BYTES) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('INVALID_JSON')); } });
    req.on('error', () => reject(new Error('REQUEST_ERROR')));
  });
}

function inspectOoxmlPackage(bytes, extension) {
  const requiredEntries = extension === 'docx' ? ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'] : ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml'];
  return new Promise(resolve => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zipfile) => {
      if (error || !zipfile) return resolve(false);
      const names = new Set(); let entryCount = 0; let uncompressedTotal = 0; let complete = false;
      const reject = () => { if (!complete) { complete = true; zipfile.close(); resolve(false); } };
      zipfile.on('error', reject);
      zipfile.on('entry', entry => {
        entryCount += 1;
        const name = entry.fileName;
        uncompressedTotal += entry.uncompressedSize;
        if (entryCount > MAX_ZIP_ENTRIES || uncompressedTotal > MAX_ZIP_UNCOMPRESSED_BYTES || /(^\/|\\|\0|(^|\/)\.\.(\/|$))/.test(name)) return reject();
        names.add(name);
        zipfile.readEntry();
      });
      zipfile.on('end', () => {
        if (complete) return;
        complete = true;
        resolve(requiredEntries.every(name => names.has(name)));
      });
      zipfile.readEntry();
    });
  });
}

async function validAttachment(attachment) {
  if (!attachment) return { ok: true, value: null };
  const name = clean(attachment.name, 120).replace(/[^a-zA-Z0-9._ -]/g, '_');
  const type = clean(attachment.type, 120).toLowerCase();
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (!name || !FILE_TYPES[extension] || !FILE_TYPES[extension].includes(type) || !/^[A-Za-z0-9+/]+={0,2}$/.test(String(attachment.content || ''))) return { ok: false, message: 'The selected attachment is not allowed. Please choose a file within the allowed size limit.' };
  const bytes = Buffer.from(attachment.content, 'base64');
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES || Number(attachment.size) !== bytes.length) return { ok: false, message: 'The selected attachment is not allowed. Please choose a file within the allowed size limit.' };
  const isPdf = bytes.subarray(0, 5).toString() === '%PDF-';
  const isJpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isCompound = bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const isOfficeZip = bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const signatures = { pdf: isPdf, jpg: isJpeg, jpeg: isJpeg, png: isPng, doc: isCompound, xls: isCompound, docx: isOfficeZip, xlsx: isOfficeZip };
  if (!signatures[extension]) return { ok: false, message: 'The selected attachment is not allowed. Please choose a file within the allowed size limit.' };
  if ((extension === 'docx' || extension === 'xlsx') && !(await inspectOoxmlPackage(bytes, extension))) return { ok: false, message: extension === 'docx' ? 'The uploaded DOCX file is not a valid Word document.' : 'The uploaded XLSX file is not a valid Excel workbook.' };
  return { ok: true, value: { name, type, content: attachment.content } };
}

async function verifyTurnstile(token, ip) {
  if (!process.env.TURNSTILE_SECRET_KEY || !process.env.TURNSTILE_HOSTNAMES) return { ok: false, configuration: true };
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip || '' });
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const result = await response.json();
  const hosts = process.env.TURNSTILE_HOSTNAMES.split(',').map(host => host.trim()).filter(Boolean);
  const expired = Array.isArray(result['error-codes']) && result['error-codes'].some(code => code === 'timeout-or-duplicate' || code === 'invalid-input-response');
  return { ok: Boolean(result.success && result.action === 'contact' && hosts.includes(result.hostname)), expired };
}

async function rateLimit(ip) {
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token, RATE_LIMIT_SALT: salt } = process.env;
  if (!url || !token || !salt) return { ok: false, configuration: true };
  const key = `contact-rate:${crypto.createHash('sha256').update(`${salt}:${ip || 'unknown'}`).digest('hex')}`;
  const request = (command, args) => fetch(`${url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify([[command, key, ...args]]) });
  const increment = await request('INCR', []); const incrementResult = await increment.json(); const count = Number(incrementResult?.[0]?.result);
  if (!Number.isFinite(count)) return { ok: false, configuration: true };
  if (count === 1) await request('EXPIRE', [String(WINDOW_SECONDS)]);
  return { ok: count <= MAX_SUBMISSIONS };
}

function trustedClientIp(req) {
  const vercelRequestId = clean(req.headers['x-vercel-id'], 256);
  const vercelIp = clean(req.headers['x-vercel-forwarded-for'], 64);
  // Vercel overwrites this header at its edge. We do not parse browser-supplied x-forwarded-for.
  if (vercelRequestId && vercelIp) return vercelIp;
  // Local development only uses the socket peer; preview and production fail closed without Vercel metadata.
  if (process.env.VERCEL_ENV === 'development' && req.socket?.remoteAddress) return req.socket.remoteAddress;
  return null;
}

async function sendResend(payload, attachment) {
  if (!process.env.RESEND_API_KEY || !process.env.CONTACT_FROM_EMAIL) throw new Error('EMAIL_CONFIGURATION');
  const details = [['Name', payload.name], ['Company', payload.company], ['Email', payload.email], ['Phone', payload.phone], ['Enquiry type', payload.enquiryType], ['Product / service', payload.productService], ['Quantity', payload.quantity], ['Project / location', payload.projectLocation], ['Required delivery date', payload.requiredDeliveryDate], ['Message', payload.message]];
  const text = details.map(([label, value]) => textLine(label, value)).join('\n');
  const html = `<h2>New ZAMTECH enquiry</h2><table>${details.map(([label, value]) => `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value || '—').replace(/\n/g, '<br>')}</td></tr>`).join('')}</table>`;
  const send = body => fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const internal = await send({ from: process.env.CONTACT_FROM_EMAIL, to: [INTERNAL_RECIPIENT], reply_to: payload.email, subject: `New ZAMTECH ${payload.enquiryType} — ${payload.name}`, text, html, ...(attachment ? { attachments: [{ filename: attachment.name, content: attachment.content, content_type: attachment.type }] } : {}) });
  if (!internal.ok) throw new Error('EMAIL_PROVIDER');
  const internalResult = await internal.json().catch(() => ({}));
  const acknowledgement = await send({ from: process.env.CONTACT_FROM_EMAIL, to: [payload.email], subject: 'We received your ZAMTECH enquiry', text: 'Thank you. Your enquiry has been submitted successfully. Our team will contact you regarding your requirement.', html: '<p>Thank you. Your enquiry has been submitted successfully.</p><p>Our team will contact you regarding your requirement.</p>' });
  return { id: internalResult.id || null, acknowledgement: acknowledgement.ok };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  if (!String(req.headers['content-type'] || '').toLowerCase().includes('application/json')) return fail(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Invalid submission format.');
  try {
    const body = await readJson(req); const ip = trustedClientIp(req);
    const payload = { name: clean(body.name, 100), company: clean(body.company, 120), email: clean(body.email, 254).toLowerCase(), phone: clean(body.phone, 50), enquiryType: clean(body.enquiryType, 60), productService: clean(body.productService, 200), quantity: clean(body.quantity, 80), projectLocation: clean(body.projectLocation, 160), requiredDeliveryDate: clean(body.requiredDeliveryDate, 20), message: clean(body.message, 5000) };
    if (clean(body.website, 200)) return fail(res, 400, 'INVALID_SUBMISSION', 'We could not submit your enquiry right now. Please try again or contact us directly.');
    if (!payload.name || !payload.company || !payload.email || !payload.phone || !payload.message || !ENQUIRY_TYPES.has(payload.enquiryType) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) || ![payload.name, payload.company, payload.email, payload.phone].every(headerSafe)) return fail(res, 400, 'VALIDATION', 'Please complete all required fields and try again.');
    if (!ip) return fail(res, 503, 'CLIENT_IDENTITY_UNAVAILABLE', 'We couldn\'t submit your enquiry right now. Please try again or contact us directly.');
    const turnstile = await verifyTurnstile(clean(body.turnstileToken, 2048), ip);
    if (!turnstile.ok) return fail(res, turnstile.configuration ? 503 : 400, turnstile.expired ? 'TURNSTILE_EXPIRED' : 'TURNSTILE_FAILED', turnstile.expired ? 'Verification expired. Please complete the verification again.' : 'Human verification failed. Please try again.');
    const limit = await rateLimit(ip); if (!limit.ok) return fail(res, limit.configuration ? 503 : 429, limit.configuration ? 'RATE_LIMIT_UNAVAILABLE' : 'RATE_LIMITED', limit.configuration ? 'We couldn\'t submit your enquiry right now. Please try again or contact us directly.' : 'Too many submission attempts were detected. Please wait a little and try again, or contact us directly.');
    const attachment = await validAttachment(body.attachment); if (!attachment.ok) return fail(res, 400, 'INVALID_ATTACHMENT', attachment.message);
    const delivery = await sendResend(payload, attachment.value);
    console.info(JSON.stringify({ event: 'contact_submission', outcome: 'accepted', emailId: delivery.id, acknowledgementSent: delivery.acknowledgement }));
    return res.status(200).json({ success: true });
  } catch (error) {
    const code = error.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'SUBMISSION_FAILED';
    console.info(JSON.stringify({ event: 'contact_submission', outcome: code }));
    return fail(res, code === 'BODY_TOO_LARGE' ? 413 : 502, code, code === 'BODY_TOO_LARGE' ? 'The selected attachment is too large. Please upload a file within the allowed size limit.' : 'We couldn\'t submit your enquiry right now. Please try again or contact us directly.');
  }
};
module.exports.config = { api: { bodyParser: false } };

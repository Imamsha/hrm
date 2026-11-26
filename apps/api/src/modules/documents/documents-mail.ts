import type { RenderedEmail } from '../notifications/mail.templates.js';

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** "Please review and accept" (ADR-018). */
export function acceptanceEmail(p: {
  organizationName: string;
  title: string;
  name: string;
  link: string;
}): RenderedEmail {
  const subject = `${p.organizationName}: please review "${p.title}"`;
  const text = [
    `Hello ${p.name},`,
    '',
    `${p.organizationName} has sent you "${p.title}" to review and accept.`,
    '',
    'Open it here:',
    p.link,
  ].join('\n');
  const html = `<p>Hello ${esc(p.name)},</p><p>${esc(p.organizationName)} has sent you <strong>${esc(p.title)}</strong> to review and accept.</p><p><a href="${esc(p.link)}">Open the document</a></p>`;
  return { subject, text, html };
}

export function acceptanceCodeEmail(p: {
  organizationName: string;
  title: string;
  code: string;
  minutes: number;
}): RenderedEmail {
  const subject = `Your code to accept "${p.title}"`;
  const text = [
    `Your one-time code to accept "${p.title}" from ${p.organizationName} is:`,
    '',
    p.code,
    '',
    `It expires in ${String(p.minutes)} minutes. If you did not ask for it, ignore this e-mail.`,
  ].join('\n');
  const html = `<p>Your one-time code to accept <strong>${esc(p.title)}</strong> from ${esc(p.organizationName)} is:</p><p style="font-size:24px;letter-spacing:4px"><strong>${p.code}</strong></p><p>It expires in ${String(p.minutes)} minutes. If you did not ask for it, ignore this e-mail.</p>`;
  return { subject, text, html };
}

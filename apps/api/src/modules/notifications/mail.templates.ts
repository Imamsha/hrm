export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0e1116">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border:1px solid #e3e5ea;border-radius:12px">
<tr><td style="padding:28px">
<p style="margin:0 0 4px;font-size:13px;color:#596070">HRM Platform</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:28px">${escapeHtml(title)}</h1>
${bodyHtml}
</td></tr></table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${escapeHtml(label)}</a></p>
<p style="margin:0;font-size:12px;color:#596070">Or paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(href)}</span></p>`;
}

export function passwordResetEmail(params: {
  fullName: string;
  link: string;
  ttlMinutes: number;
}): RenderedEmail {
  const subject = 'Reset your HRM Platform password';
  const text = [
    `Hi ${params.fullName},`,
    '',
    'We received a request to reset your password. Use the link below to choose a new one:',
    params.link,
    '',
    `The link expires in ${String(params.ttlMinutes)} minutes and can be used once.`,
    'If you did not request this, you can ignore this e-mail — your password stays unchanged.',
  ].join('\n');
  const html = layout(
    'Reset your password',
    `<p style="margin:0 0 12px;font-size:14px;line-height:22px">Hi ${escapeHtml(params.fullName)},</p>
<p style="margin:0;font-size:14px;line-height:22px">We received a request to reset your password.</p>
${button(params.link, 'Choose a new password')}
<p style="margin:16px 0 0;font-size:13px;color:#596070">The link expires in ${String(params.ttlMinutes)} minutes and can be used once. If you did not request this, ignore this e-mail.</p>`,
  );
  return { subject, text, html };
}

export function invitationEmail(params: {
  organizationName: string;
  inviterName: string;
  link: string;
  ttlDays: number;
}): RenderedEmail {
  const subject = `${params.inviterName} invited you to ${params.organizationName} on HRM Platform`;
  const text = [
    `${params.inviterName} invited you to join ${params.organizationName} on HRM Platform.`,
    '',
    'Accept the invitation:',
    params.link,
    '',
    `The invitation expires in ${String(params.ttlDays)} days.`,
  ].join('\n');
  const html = layout(
    `Join ${params.organizationName}`,
    `<p style="margin:0;font-size:14px;line-height:22px">${escapeHtml(params.inviterName)} invited you to join <strong>${escapeHtml(params.organizationName)}</strong> on HRM Platform.</p>
${button(params.link, 'Accept invitation')}
<p style="margin:16px 0 0;font-size:13px;color:#596070">The invitation expires in ${String(params.ttlDays)} days.</p>`,
  );
  return { subject, text, html };
}

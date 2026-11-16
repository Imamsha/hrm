import { describe, expect, it } from 'vitest';
import { invitationEmail, passwordResetEmail } from './mail.templates.js';

describe('mail templates', () => {
  it('renders the password reset link in text and HTML', () => {
    const m = passwordResetEmail({
      fullName: 'Asha',
      link: 'http://x.test/reset?token=abc',
      ttlMinutes: 30,
    });
    expect(m.text).toContain('http://x.test/reset?token=abc');
    expect(m.html).toContain('href="http://x.test/reset?token=abc"');
    expect(m.text).toContain('30 minutes');
  });

  it('escapes user-controlled values in HTML', () => {
    const m = invitationEmail({
      organizationName: '<script>alert(1)</script>',
      inviterName: 'Eve "the" <b>',
      link: 'http://x.test/i?t=1&x=2',
      ttlDays: 7,
    });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('href="http://x.test/i?t=1&amp;x=2"');
  });
});

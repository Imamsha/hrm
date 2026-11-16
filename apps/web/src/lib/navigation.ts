/** Only allow same-origin relative redirects after sign-in (open-redirect protection). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

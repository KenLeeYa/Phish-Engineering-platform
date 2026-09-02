export const SESSION_COOKIE = "sea_session";
export const CSRF_COOKIE = "sea_csrf";

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      continue;
    }
  }
  return cookies;
}

function cookie(
  name: string,
  value: string,
  options: { httpOnly: boolean; secure: boolean; maxAgeSeconds: number },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "SameSite=Strict",
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

export function sessionCookies(
  sessionToken: string,
  csrfToken: string,
  secure: boolean,
  maxAgeSeconds: number,
): string[] {
  return [
    cookie(SESSION_COOKIE, sessionToken, { httpOnly: true, secure, maxAgeSeconds }),
    cookie(CSRF_COOKIE, csrfToken, { httpOnly: false, secure, maxAgeSeconds }),
  ];
}

export function expiredSessionCookies(secure: boolean): string[] {
  return [
    cookie(SESSION_COOKIE, "", { httpOnly: true, secure, maxAgeSeconds: 0 }),
    cookie(CSRF_COOKIE, "", { httpOnly: false, secure, maxAgeSeconds: 0 }),
  ];
}

// Content-Security-Policy, sent report-only first (#347). Imported by
// next.config.ts, so keep it dependency-free and use no `@/` alias.
//
// Origins come from the Firebase web SDK: Auth (identitytoolkit, securetoken,
// the <project>.firebaseapp.com handler and its iframe), Firestore
// (firestore.googleapis.com over HTTPS/WebChannel), apis.google.com and
// gstatic for the SDK's loaders. Storage (invoice files, #373) is
// firebasestorage.googleapis.com, already under *.googleapis.com: files are
// fetched into a Blob over connect-src and opened as blob: URLs, so img-src,
// frame-src and object-src stay as they are.
//
// ponytail: 'unsafe-inline' scripts because Next inlines its bootstrap and
// there is no nonce yet. Before enforcing, move to nonces via a proxy.

export const CSP_REPORT_PATH = "/api/csp-report"

export function buildCsp(isDev: boolean): string {
  const scriptSrc = ["'self'", "'unsafe-inline'", "https://apis.google.com", "https://www.gstatic.com"]
  const connectSrc = [
    "'self'",
    "https://*.googleapis.com",
    "https://*.firebaseio.com",
    "https://*.firebaseapp.com",
    "https://www.gstatic.com",
  ]
  if (isDev) {
    // React's dev tooling evals; the emulators and HMR run on localhost.
    scriptSrc.push("'unsafe-eval'")
    connectSrc.push("http://127.0.0.1:*", "http://localhost:*", "ws://localhost:*", "ws://127.0.0.1:*")
  }
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-src 'self' https://*.firebaseapp.com https://apis.google.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ")
}

/**
 * Every security header the app sends, on every route. next.config.ts serves
 * these; tests import them from here, never from next.config.ts, because
 * Firebase App Hosting replaces next.config.ts at build time and its stand-in
 * has no default export (the 0.15.1 rollout failed on exactly that).
 */
export function securityHeaders(isDev: boolean): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy-Report-Only", value: buildCsp(isDev) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-XSS-Protection", value: "1; mode=block" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ]
}

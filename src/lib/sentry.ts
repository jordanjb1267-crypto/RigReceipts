import * as Sentry from '@sentry/react-native';

/**
 * Sentry error monitoring. The DSN is a publishable client key configured via
 * env; when unset (local dev without .env), Sentry stays disabled so nothing is
 * reported. Never attach document contents, OCR text, or rate amounts to
 * events — the privacy rules that apply to analytics apply here too.
 */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    // Keep default PII collection off; errors only, no session replay.
    sendDefaultPii: false,
    tracesSampleRate: 0.2,
    enableNativeCrashHandling: true,
  });
}

export { Sentry };

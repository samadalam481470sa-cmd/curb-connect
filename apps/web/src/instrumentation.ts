// Runs once when the Next.js server starts.
//
// On hosts where the web app and the API sleep separately (Render free plan), opening the site
// wakes only the web service. The API would not start waking until the browser's first /v1 call
// arrived, so the two cold starts happened one after the other. Pinging the API's health endpoint
// here starts both together. It is fire-and-forget: register() must return before the server
// accepts requests, and a failed ping changes nothing (the /v1 proxy still waits for the API).
export function register(): void {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production') return;
  const target = process.env.API_PROXY_TARGET;
  if (!target) return;
  const url = `${target.replace(/\/$/, '')}/v1/health`;
  void fetch(url, { signal: AbortSignal.timeout(120_000) })
    .then((res) => console.info(`[web] API wake-up ping answered ${res.status}`))
    .catch((error: unknown) =>
      console.warn(
        `[web] API wake-up ping failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
}

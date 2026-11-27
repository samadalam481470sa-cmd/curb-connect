// GET /.well-known/assetlinks.json — Digital Asset Links for the Android TWA.
// Android verifies this file against the app signing certificate before it will open the
// site full-screen inside the wrapper. It stays 404 until the owner sets both
// ANDROID_TWA_SHA256 (the signing certificate's SHA-256 fingerprint, colon-separated hex)
// and ANDROID_PACKAGE_NAME on the web service, so the site never publishes a claim it
// cannot back. See docs/android-twa.md.

export function GET() {
  const sha256 = process.env.ANDROID_TWA_SHA256?.trim();
  const packageName = process.env.ANDROID_PACKAGE_NAME?.trim();
  if (!sha256 || !packageName) {
    return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const body = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: [sha256],
      },
    },
  ];
  return Response.json(body, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}

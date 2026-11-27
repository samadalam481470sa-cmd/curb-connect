# Android app (Trusted Web Activity)

Field Pro's Android app is a **Trusted Web Activity (TWA)**: a thin Android wrapper that
opens the live Field Pro PWA full-screen, with the same sign-in, offline queue, and Web
Push. There is no second codebase to maintain — the wrapper points at the production
site, so every web deploy updates the app.

## What is already in place

- Installable PWA manifest (`apps/web/src/app/manifest.ts`) with 192/512/maskable icons —
  the exact shape a TWA reads.
- Service worker with push + notification-click handlers (`apps/web/public/sw.js`).
- `/.well-known/assetlinks.json` route (web app) that serves the Digital Asset Links
  file Android requires — **404 until the owner sets the signing fingerprint** (below),
  so the site never publishes a claim it cannot back.
- `native/android/twa-manifest.example.json` — a Bubblewrap manifest template with
  placeholders clearly marked.

## Owner steps (need a Google Play Console account — cannot be done from here)

1. Create the app in Google Play Console and note the package name you choose
   (e.g. `com.fieldpro.app`).
2. Generate the wrapper with Bubblewrap on a machine with the Android SDK:
   `npx @bubblewrap/cli init --manifest https://<production-host>/manifest.webmanifest`
   then `npx @bubblewrap/cli build`. Keep the generated signing keystore safe — losing
   it means you cannot update the app.
3. Read the signing certificate's SHA-256 fingerprint (`keytool -list -v -keystore ...`).
4. On the `curb-connect-web` Render service set:
   - `ANDROID_PACKAGE_NAME` = the package name from step 1
   - `ANDROID_TWA_SHA256` = the fingerprint from step 3 (colon-separated hex)
5. Deploy web, then confirm `https://<production-host>/.well-known/assetlinks.json`
   returns the JSON (it 404s until both variables are set).
6. Upload the `.aab` from step 2 to Play Console and complete the store listing.

## Push on Android

- The TWA uses the site's Web Push (VAPID) — the same subscription flow as the browser,
  registered through `POST /v1/devices` with `platform: "web"`. No Firebase project is
  needed for that path.
- A native FCM path (for a future non-TWA shell) is shaped in the devices API
  (`platform: "android"` registrations are accepted) but delivery stays honestly
  `native_push_not_connected` until a Firebase project + service account exists. The
  devices screen says so in-app.

## Honest limits

- Nothing here is in the Play Store yet; steps 1–6 above are owner-only.
- The TWA needs the production site reachable over HTTPS with a valid certificate.
- Android verifies assetlinks against the **signing** certificate — after enabling
  Play App Signing, use the Play-managed fingerprint shown in Play Console, not the
  upload key's.

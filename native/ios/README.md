# Field Pro native iPhone AR measurement

This is native iOS source, separate from the deployed PWA. Apple ARKit APIs cannot
be used from Safari or an iOS Home Screen web app. This is not a signed App Store build.

## Build on a Mac

1. Install Xcode and XcodeGen from https://github.com/yonaskolb/XcodeGen.
2. From this folder run xcodegen generate to produce FieldPro.xcodeproj.
3. Open the project in Xcode; set your Apple Developer Team and unique bundle ID.
4. Attach a physical ARKit-capable iPhone. The iOS Simulator cannot track surfaces.
5. Build and install. Sign into Field Pro inside the embedded WKWebView.
6. Open Curb Cutting > iPhone AR Measure > Start iPhone ARKit measure.
7. Scan the visible curb, mark each bend with the center reticle, and use the
   returned measured length in the estimate.

ARKit world tracking requires a supported iPhone. LiDAR-equipped iPhones request
smoothedSceneDepth/sceneDepth only if the hardware reports support. On LiDAR devices,
centre-reticle measurements sample real scene depth, reject low-confidence pixels,
use median filtering, and transform camera-space depth into ARKit world coordinates.
Points can fall back to surface raycasts when depth is unavailable or insufficiently
reliable; each method is counted in the UI and returned with the result.
This is a mixed-source surface polyline, not a complete scan, engineered survey,
independent LiDAR hardware, or proof of millimetre accuracy.
Buried depth, rebar, reinforcement and utilities cannot be inferred from this tool.

The bridge passes only a positive finite length in feet, the actual measurement
source, sensor availability, and depth/raycast point counts; it does not transmit
camera video or depth maps.

The iPhone native app must be built and signed with Xcode on a Mac. It is not
available merely by refreshing the production website. Validate the optical
centre calibration against field control distances on each supported device.

## Release gates

- Build and test with Xcode on physical iPhones, including a LiDAR model.
- Test login, camera permissions, lost tracking, App Store privacy declarations,
  accessibility, lifecycle and known tape-measured sample curbs.
- Configure the legal app bundle, Apple signing and distribution.
- Do not claim availability before signed installation or App Store publication.
- WebXR hit-test on compatible non-iPhones uses the real device AR runtime.
- Unsupported devices keep the calibrated-photo and manual measurement tools.

## Push notifications (APNs hooks — gated)

The shell also carries APNs registration hooks, compiled only with the
`FIELDPRO_NATIVE_PUSH` build flag (set in `project.yml`):

- `FieldProApp.swift` requests notification authorization at launch and registers for
  remote notifications; the device token is handed to the web bridge.
- `FieldProWebView.swift` injects the token into the page
  (`window.__fieldProNativeToken` + a `fieldpro-native-token` event, and re-injects on
  a `fieldProPush` / `{action: "token"}` message from the page).
- The web app's `NativeDeviceBridge` component registers the token through
  `POST /v1/devices` with `platform: "ios"`. In a normal browser there is no token and
  the component does nothing.

Registering a token is only half of push. Server-side APNs delivery is **not
connected**: the API reports iOS devices as `native_push_not_connected` until the owner
has an Apple Developer account, creates an APNs auth key (.p8), and the server sender
is wired to it. The in-app devices screen says exactly that. This shell has never been
compiled in the environment that wrote the push hooks — build it on a Mac with Xcode
and expect to fix small Swift issues on first build. Nothing here claims App Store
readiness.

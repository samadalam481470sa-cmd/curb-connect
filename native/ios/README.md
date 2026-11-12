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
sceneDepth only if the hardware reports support. Polyline measurements come
from ARKit world-space surface raycasts, not raw LiDAR point-cloud reconstruction.
A LiDAR-capable phone is not proof that every point has verified depth confidence.
Buried depth, rebar, reinforcement and utilities cannot be inferred from this tool.

The bridge passes only a positive finite length in feet, a source label and
a sensor availability flag; it does not transmit camera video or depth maps.

## Release gates

- Build and test with Xcode on physical iPhones, including a LiDAR model.
- Test login, camera permissions, lost tracking, App Store privacy declarations,
  accessibility, lifecycle and known tape-measured sample curbs.
- Configure the legal app bundle, Apple signing and distribution.
- Do not claim availability before signed installation or App Store publication.
- WebXR hit-test on compatible non-iPhones uses the real device AR runtime.
- Unsupported devices keep the calibrated-photo and manual measurement tools.

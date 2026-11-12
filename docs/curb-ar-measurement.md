# Curb AR measurement — feature gates and validation

This release adds functionality without removing the existing camera-photo estimator.

## Capability matrix

| Runtime | Mode | Reality/limits |
|---|---|---|
| Field Pro native iPhone application (source under native/ios) | ARKit raycasts, real-world 3D point polyline; sceneDepth enabled only on LiDAR devices | Requires a Mac, XcodeGen, signing and a physical ARKit iPhone. Not available from the PWA or App Store yet. |
| iPhone Safari / installed PWA | Existing calibrated photo and manual entry | No native ARKit bridge available in Safari; the unavailable option is explained and disabled. |
| Compatible Android WebXR browser/AR runtime | Immersive AR hit-test and tracked ground/surface points | Requires WebXR immersive-ar, hit-test, DOM overlay and secure context. Runtime may decline access. Not equivalent to a physical LiDAR sensor. |
| Other Android/desktop/browser | Existing calibrated photo and manual entry | No fabricated depth data or invented device hardware. |

**Feature switches**: NEXT_PUBLIC_FIELDPRO_NATIVE_AR=false hides native AR controls.
NEXT_PUBLIC_FIELDPRO_WEBXR=false hides the experimental WebXR option. The existing photo tool remains unchanged.
These are compile-time deployment options and require a rebuild when changed.

The mobile bottom navigation has five entries. When invoice:read is allowed, an Invoices
shortcut occupies the last slot. Settings remains available in the menu/sidebar.
Users with bill:read see the Invoice Master Dashboard; invoice-only roles open Billing.
Roles without invoice permission keep their original navigation.

## Verification

- CI checks TypeScript, lint, geometry unit tests, integration tests, production build and Playwright journeys.
- Native Swift/Xcode must be built and run on actual iPhones; this CI has no macOS/iOS hardware.
- Android WebXR requires real compatible hardware and browser (cannot be simulated by DOM tests alone).
- Check a curb with a tape in good and poor light, low-texture pavement and tracking loss.
- Review every measurement before a bid or any saw cut; always confirm depth with cores/probes and 811 locates.
- No sensor or camera imagery is transmitted automatically; only an explicitly accepted scalar length enters the estimator.

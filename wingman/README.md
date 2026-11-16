# Wingman overlay

An always-on-top desktop assistant whose window is excluded from screen capture, and whose
answers stream token by token into the chat log underneath the question.

Standalone Electron app. It is not part of the Field Pro workspaces and does not affect the
product build.

## Run

```bash
cd wingman
npm install
cp .env.example .env      # GEMINI_API_KEY, or OLLAMA_MODEL for a local model
npm start
```

`npm start` compiles `electron/*.ts` to `dist-electron/` and launches the app.

## Hotkeys

| Keys | Action |
| --- | --- |
| `Ctrl/Cmd`+`Shift`+`Space` | Show / hide, and put the caret in the field |
| `Ctrl/Cmd`+`Shift`+`A` | Answer whatever is on the clipboard |
| `Ctrl/Cmd`+`Shift`+`Enter` | Answer the question on the display under the cursor |
| `Ctrl/Cmd`+`Shift`+`R` | Drag a region and ask about only that |
| `Ctrl/Cmd`+`Shift`+`X` | Toggle click-through (overlay stops eating clicks) |
| `Ctrl/Cmd`+`Shift`+`H` | Hide |
| `Esc` | Hide |

Accelerators live in one `SHORTCUTS` map at the top of `electron/main.ts`; if one clashes with
something you use, change it there (the app warns on stderr when a hotkey is already taken).

## Clipboard answers

Copy a question, press `Ctrl/Cmd+Shift+A`. That is the cheapest and most accurate input: no
screenshot, no OCR loss on small text, and nothing about your desktop goes to the provider — only
the text that is already on your clipboard. It goes through the same streaming path as a typed
question, so the answer still paints token by token in the log.

Text is trimmed and `CRLF` normalised, and capped at 20,000 characters so a copied log file is not
uploaded whole; when that happens the panel says how much was left out instead of silently sending
a fragment. An empty clipboard produces a notice, not an empty model call.

## What gets captured

Only the display the pointer is on (`screen.getDisplayNearestPoint(screen.getCursorScreenPoint())`), at
that display's native pixel resolution — no downscale, so small code and terminal text survive into
the model. Multi-monitor works because the capture follows the cursor, not the primary display.

**Region** freezes that capture into a selector window: drag a rectangle over the part that matters
and only that crop is uploaded, so the rest of your desktop never leaves the machine. Esc or a
single click cancels without asking anything. The crop is computed from the captured image's own
pixel size (`electron/region.ts`), so it is exact on any DPI, window size or monitor arrangement.

On macOS the **Screen Recording** permission is checked before capture
(`systemPreferences.getMediaAccessStatus('screen')`). If it is missing, the request fails with an
explicit notice and an *Open System Settings* button instead of quietly answering from text alone,
and the panel says so at launch when the grant is already denied. Granting it requires relaunching
the app.

## Why it is invisible in a screen share

`transparent` / `alwaysOnTop` only change appearance; a screen share still captures them. Two
calls do the work, once, when the window is created:

1. **`win.setContentProtection(true)`** — Windows `SetWindowDisplayAffinity(hwnd,
   WDA_EXCLUDEFROMCAPTURE)`, macOS `NSWindow.sharingType = NSWindowSharingNone`. The compositor
   drops the window from every capture path, so a shared desktop does not include it.
2. **Window level** — a macOS `panel` window pinned with `setAlwaysOnTop(true, 'screen-saver', 1)`
   and `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, out of the taskbar and
   with no shadow, so it stays above a full-screen call instead of being covered.

Only the level can be lost, and only by leaving the window, another app going full-screen, coming
back from minimised, or changing displays. Those re-assert it (`show`, `blur`, `restore`,
`display-metrics-changed`). There is no polling timer: `isAlwaysOnTop()` reports the flag this app
set, not the level the OS holds, so a timer cannot detect a lost level — and re-ordering the window
on a timer is exactly what flickers.

## Typing with the dock icon hidden

Hiding the dock icon makes the app an accessory, and an `NSPanel` from an accessory app is not the
key window just because it is visible, so keystrokes go nowhere. There is one activation path, in
`showOverlay`: activate the process first (`app.focus({ steal: true })`), then `show()`,
`win.focus()`, `webContents.focus()`. It runs only on explicit intent — hotkey or app activate —
and launch stays passive (`showInactive`) so starting the app never pulls focus out of a call.
Clicks need no hook: `acceptFirstMouse` activates the app and delivers the click in one gesture.
There is no retry timer, because a delayed second activation races the user's own click.

## Why answers arrive immediately

The reference implementation made two sequential non-streaming model calls and asked for a JSON
envelope (`problem_statement`, `context`, `suggested_responses`, `reasoning`) before showing the
answer. That is why replies were slow and hedgy: the envelope makes the model narrate an analysis
instead of answering, and the UI has nothing to render until both round trips finish.

Here there is one streamed request (`streamGenerateContent` SSE for Gemini, `/api/chat` NDJSON for
Ollama), no JSON schema, and a prompt that requires the direct answer on the first line. The
renderer paints the answer bubble on send, appends each token as it arrives, auto-scrolls and
reports first-token latency; `backgroundThrottling: false` keeps that alive while unfocused.

## Quitting and re-opening

The overlay is the only window: no chrome, no dock icon, no taskbar entry and no application menu.
That is the point, but it used to leave `kill` as the only way out. There are now three ways:

- **Tray / menu-bar item**, created at startup. Its icon is generated at runtime by
  `electron/tray-icon.ts` (a BGRA ring, a template image on macOS, an accent-coloured one
  elsewhere), so there is no image asset to ship or lose. On macOS left click shows/hides the
  overlay and right click opens the menu; on Windows and Linux left click toggles and the context
  menu carries the rest. The menu shows the active provider and model and offers Show / hide,
  Answer clipboard, Answer screen, Select an area and **Quit Wingman**.
- **Quit** in the panel header, next to Hide, wired to `ui:quit`.
- **Launching it again** no longer exits silently. The single-instance lock sends
  `second-instance` to the copy already running, which reveals it and focuses the input. If the
  second launch arrives before the window is ready, the reveal is applied on `ready-to-show` instead
  of being dropped.

Quitting unregisters the global shortcuts and destroys the tray icon.

## Surviving a live call

- **One budget.** The whole ask, retries included, must finish inside 25 s; a request that stalls is
  reported as a timeout instead of blinking a caret forever.
- **Retries.** `429`, `5xx` and connection failures are retried at 600 ms then 1.8 s (with jitter),
  honouring `Retry-After` up to 5 s and never sleeping past the budget. Retries happen **only while
  nothing has been shown yet**, so a dropped stream cannot restart and duplicate an answer you are
  already reading.
- **Local fallback.** If Gemini ultimately fails and `OLLAMA_MODEL` is set, the same question goes to
  Ollama. The panel says a fallback happened and the status line marks the answer `local model`.
  Without a local model configured, the real error is shown instead of a silent nothing.
- **Stop.** The Ask button becomes **Stop** while streaming. Stopping keeps the partial answer and
  reports `stopped after Xs` rather than pretending it completed.
- **Request ids.** Every ask carries an id from the renderer, and every chunk/done/error event carries
  it back. A late event from a stopped request can no longer land in the next answer's bubble — which
  is what makes stopping and falling back safe to do mid-call.

## Verify

```bash
npm run verify   # logic, no window needed
npm run smoke    # real window, macOS / Windows
```

`verify` runs the compiled `electron/overlay.js` against a mocked Electron (panel option, one-time
capture protection and Spaces, no re-application across repeated move/resize/focus/blur, level
re-asserted only on show/blur/restore and restored after being lost, activation order, passive
launch, click-through, singleton, no timers), the region mapping in `electron/region.ts`
(proportional crop, clamping at every edge, accidental-click and non-finite input rejection), and
the probe's marker detection on synthetic BGRA frames (count, bounding box, coverage, UI colours
rejected, black-box vs ordinary desktop), the clipboard preparation, and the answer path against a
stubbed `fetch` — 429 retry then success, 5xx exhausting the budget, fallback to Ollama, no fallback
when no local model is configured, stop keeping the partial answer, the timeout firing, and no
retry once text has been shown.

### Is it actually invisible on this machine? (macOS / Windows)

```bash
npm run probe
```

Paints the real overlay solid magenta, captures the display from the app's own process, and looks
for those pixels. The sequence is A/B/A — protection **off** (marker must be captured), **on**
(marker must vanish), **off** again (marker must return) — so a capture that never included the
window reports INCONCLUSIVE instead of a false pass. It also measures what the protected capture
shows in that rectangle, which distinguishes real exclusion from the Windows `WDA_MONITOR` black
box (content hidden, but still a visible black rectangle on the recording).

Exit codes: `0` excluded, `1` detectable or black-box, `2` inconclusive (usually the missing macOS
Screen Recording grant). This measures Electron/Chromium capture — the same stack a browser screen
share uses — so a FAIL is definitive and a PASS is strong but does not cover a recorder that uses a
different OS capture API.

`smoke` launches the real overlay — real window, preload and renderer, dock icon hidden on macOS —
and prints PASS/FAIL per check: window visible and pinned, **the panel becomes the key window**
(fails loudly with platform diagnostics if not), `sendInputEvent` text lands in the textarea, Enter
opens a streaming bubble, the window is genuinely unfocused, every chunk paints progressively while
unfocused, and the done state clears the caret. Chunks are injected on the real `ai:chunk` channel,
so no API key is needed. `sendInputEvent` bypasses OS key routing, so the key-window check — not the
typing check — is what proves real keystrokes would land.

## Limits

- **No overlay is undetectable by everything.** This hides the window from screen capture. It does
  not hide the process from the OS, corporate device management, an anti-cheat driver, or someone
  standing behind you.
- **Screen questions send pixels to your provider**, so the region selector is the safer default:
  a full-display ask uploads everything visible on that monitor, including anything private in it.
- **macOS 14+**: capture paths built on ScreenCaptureKit can ignore `NSWindowSharingNone`, so a
  ScreenCaptureKit recorder may still show the panel. The Windows path (`WDA_EXCLUDEFROMCAPTURE`,
  Windows 10 2004+) is the reliable one; older Windows shows a black box instead.
- **Linux** depends on the compositor; X11 honours content protection inconsistently.
- **Exclusive full-screen games** and protected surfaces can still cover or block the overlay.
- Recording or assisting in a proctored interview, exam or recorded meeting behind the other
  participants' back can break the rules you agreed to and, depending on where you are, the law.
  This is built for legitimate live assistance: your own notes, sales and support copilots,
  accessibility and study. You are responsible for how you use it.

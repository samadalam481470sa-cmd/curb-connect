import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CurbCameraMeasure, openRearCamera } from './CurbCameraMeasure';

type FakeTrack = {
  stop: ReturnType<typeof vi.fn>;
  getCapabilities?: () => object;
  applyConstraints: ReturnType<typeof vi.fn>;
};

function fakeStream(caps: object = {}) {
  const track: FakeTrack = {
    stop: vi.fn(),
    getCapabilities: () => caps,
    applyConstraints: vi.fn().mockResolvedValue(undefined),
  };
  return {
    track,
    stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream,
  };
}

function domError(name: string) {
  return new DOMException('x', name);
}

function setMedia(getUserMedia: ReturnType<typeof vi.fn> | undefined) {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: getUserMedia ? { getUserMedia } : undefined,
  });
}

const W = 800,
  H = 600;
/** Photo: dark ground, bright 200×150 px sheet at (300,300)-(500,450), bright curb band below y=520. */
function scenePixels() {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inSheet = x >= 300 && x < 500 && y >= 300 && y < 450;
      const curb = y >= 520;
      const v = inSheet ? 240 : curb ? 200 : 60;
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return data;
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  const ctx = {
    drawImage: vi.fn(),
    getImageData: () => ({ width: W, height: H, data: scenePixels() }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA');
  URL.createObjectURL = vi.fn(() => 'blob:photo');
  URL.revokeObjectURL = vi.fn();
  // Image decode stub with the scene's natural size.
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = W;
      naturalHeight = H;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setMedia(undefined);
});

describe('openRearCamera', () => {
  it('asks for the rear camera first', async () => {
    const { stream } = fakeStream();
    const gum = vi.fn().mockResolvedValue(stream);
    await openRearCamera({ getUserMedia: gum } as unknown as MediaDevices);
    expect(gum.mock.calls[0]![0].video.facingMode).toEqual({ ideal: 'environment' });
  });

  it('retries with simpler settings when the phone rejects the ideal resolution', async () => {
    const { stream } = fakeStream();
    const gum = vi
      .fn()
      .mockRejectedValueOnce(domError('OverconstrainedError'))
      .mockRejectedValueOnce(domError('NotFoundError'))
      .mockResolvedValue(stream);
    await expect(openRearCamera({ getUserMedia: gum } as unknown as MediaDevices)).resolves.toBe(
      stream,
    );
    expect(gum).toHaveBeenCalledTimes(3);
    expect(gum.mock.calls[2]![0]).toEqual({ audio: false, video: true });
  });

  it('does not keep retrying after the user denies permission', async () => {
    const gum = vi.fn().mockRejectedValue(domError('NotAllowedError'));
    await expect(
      openRearCamera({ getUserMedia: gum } as unknown as MediaDevices),
    ).rejects.toThrow();
    expect(gum).toHaveBeenCalledTimes(1);
  });
});

describe('CurbCameraMeasure live camera', () => {
  for (const ua of [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', // iPadOS
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
  ]) {
    it(`opens the live camera and captures a frame (${ua.slice(13, 40)}…)`, async () => {
      vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
      const { stream, track } = fakeStream();
      setMedia(vi.fn().mockResolvedValue(stream));
      render(<CurbCameraMeasure onApplyLength={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
      const video = await screen.findByLabelText('Live rear camera preview');
      Object.defineProperty(video, 'videoWidth', { value: W });
      Object.defineProperty(video, 'videoHeight', { value: H });
      fireEvent.click(screen.getByRole('button', { name: 'Capture frame' }));
      expect(track.stop).toHaveBeenCalled();
      expect(await screen.findByTestId('camera-photo')).toBeTruthy();
    });
  }

  it('shows a clear message and keeps the photo option when permission is denied', async () => {
    setMedia(vi.fn().mockRejectedValue(domError('NotAllowedError')));
    render(<CurbCameraMeasure onApplyLength={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/permission was denied/);
    expect(screen.getByRole('button', { name: 'Take Photo / Choose Image' })).toBeTruthy();
  });

  it('opens the system photo picker when the browser has no camera API', () => {
    setMedia(undefined);
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    render(<CurbCameraMeasure onApplyLength={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    expect(click).toHaveBeenCalled();
  });

  it('offers the flashlight only when the camera supports it', async () => {
    const { stream, track } = fakeStream({ torch: true });
    setMedia(vi.fn().mockResolvedValue(stream));
    render(<CurbCameraMeasure onApplyLength={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Flashlight on' }));
    await waitFor(() =>
      expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] }),
    );
    expect(await screen.findByRole('button', { name: 'Flashlight off' })).toBeTruthy();
  });

  it('releases the camera when the app goes to the background', async () => {
    const { stream, track } = fakeStream();
    setMedia(vi.fn().mockResolvedValue(stream));
    render(<CurbCameraMeasure onApplyLength={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    await screen.findByLabelText('Live rear camera preview');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(track.stop).toHaveBeenCalled();
    expect(screen.queryByLabelText('Live rear camera preview')).toBeNull();
  });

  it('stops the camera when the component unmounts', async () => {
    const { stream, track } = fakeStream();
    setMedia(vi.fn().mockResolvedValue(stream));
    const view = render(<CurbCameraMeasure onApplyLength={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    await screen.findByLabelText('Live rear camera preview');
    view.unmount();
    expect(track.stop).toHaveBeenCalled();
  });
});

describe('CurbCameraMeasure photo measuring', () => {
  async function loadPhoto() {
    render(<CurbCameraMeasure onApplyLength={onApply} />);
    const input = screen.getByLabelText('Take or choose a curb photo');
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'curb.jpg', { type: 'image/jpeg' })] },
    });
    const surface = await screen.findByTestId('camera-photo');
    // Displayed at the photo's own size: 1 CSS px = 1 image px.
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: W,
      height: H,
      right: W,
      bottom: H,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    return surface;
  }
  const tap = (el: Element, x: number, y: number, id = 1) => {
    fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: id });
    fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: id });
  };
  let onApply = vi.fn();
  beforeEach(() => {
    onApply = vi.fn();
  });

  it('snaps rough corner taps onto the sheet and measures the curb', async () => {
    const surface = await loadPhoto();
    // Sheet is 200 px wide = 8.5 in, so 1 px = 8.5/200 in; taps are 5–7 px off each corner.
    tap(surface, 306, 294);
    tap(surface, 494, 305);
    tap(surface, 505, 444);
    tap(surface, 295, 455);
    expect(screen.getByText(/4 of 4 points snapped/)).toBeTruthy();
    // Curb edge at y = 520; taps 6 px above it, 400 px apart.
    tap(surface, 200, 514);
    tap(surface, 600, 514);
    const result = await screen.findByTestId('camera-result');
    // 400 px × 8.5/200 in/px = 17 in = 1.4167 ft.
    const feet = Number(/([\d.]+) ft/.exec(result.textContent ?? '')![1]);
    expect(feet).toBeGreaterThan(1.39);
    expect(feet).toBeLessThan(1.44);
    expect(screen.getByTestId('camera-accuracy').textContent).toMatch(/Likely range/);
    fireEvent.click(screen.getByRole('button', { name: 'Use length in curb estimate' }));
    expect(onApply).toHaveBeenCalledWith(Number(feet.toFixed(2)));
  });

  it('measures raw taps when auto-snap is off', async () => {
    const surface = await loadPhoto();
    fireEvent.click(screen.getByRole('button', { name: 'Auto-snap on' }));
    for (const [x, y] of [
      [300, 300],
      [500, 300],
      [500, 450],
      [300, 450],
      [200, 520],
      [600, 520],
    ] as const)
      tap(surface, x, y);
    expect(screen.getByText(/0 of 6 points snapped/)).toBeTruthy();
    const feet = Number(
      /([\d.]+) ft/.exec(screen.getByTestId('camera-result').textContent ?? '')![1],
    );
    expect(feet).toBeCloseTo(1.42, 2);
  });

  it('drags an existing point instead of adding a new one', async () => {
    const surface = await loadPhoto();
    fireEvent.click(screen.getByRole('button', { name: 'Auto-snap on' }));
    for (const [x, y] of [
      [300, 300],
      [500, 300],
      [500, 450],
      [300, 450],
      [200, 520],
      [600, 520],
    ] as const)
      tap(surface, x, y);
    fireEvent.pointerDown(surface, { clientX: 602, clientY: 521, pointerId: 7 });
    fireEvent.pointerMove(surface, { clientX: 700, clientY: 520, pointerId: 7 });
    fireEvent.pointerUp(surface, { clientX: 700, clientY: 520, pointerId: 7 });
    expect(screen.getByText(/2\. Curb path \(2 points\)/)).toBeTruthy();
    const feet = Number(
      /([\d.]+) ft/.exec(screen.getByTestId('camera-result').textContent ?? '')![1],
    );
    expect(feet).toBeCloseTo((500 * 8.5) / 200 / 12, 2);
  });

  it('nudges the selected point with arrow keys', async () => {
    const surface = await loadPhoto();
    fireEvent.click(screen.getByRole('button', { name: 'Auto-snap on' }));
    for (const [x, y] of [
      [300, 300],
      [500, 300],
      [500, 450],
      [300, 450],
      [200, 520],
      [600, 520],
    ] as const)
      tap(surface, x, y);
    const before = Number(
      /([\d.]+) ft/.exec(screen.getByTestId('camera-result').textContent ?? '')![1],
    );
    for (let i = 0; i < 4; i++) fireEvent.keyDown(surface, { key: 'ArrowRight', shiftKey: true });
    const after = Number(
      /([\d.]+) ft/.exec(screen.getByTestId('camera-result').textContent ?? '')![1],
    );
    expect(after).toBeCloseTo(before + (40 * 8.5) / 200 / 12, 2);
  });

  it('presets, swap and undo update the reference', async () => {
    const surface = await loadPhoto();
    fireEvent.change(screen.getByLabelText('Reference object'), { target: { value: 'tabloid' } });
    expect((screen.getByLabelText('Reference width (inches)') as HTMLInputElement).value).toBe(
      '11',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Swap width/height' }));
    expect((screen.getByLabelText('Reference width (inches)') as HTMLInputElement).value).toBe(
      '17',
    );
    tap(surface, 300, 300);
    expect(screen.getByText(/1\. Reference \(1\/4\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText(/1\. Reference \(0\/4\)/)).toBeTruthy();
  });

  it('rejects files that are not images', async () => {
    render(<CurbCameraMeasure onApplyLength={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Take or choose a curb photo'), {
      target: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' })] },
    });
    expect((await screen.findByRole('alert')).textContent).toMatch(/supported image/);
  });
});

from __future__ import annotations

from fractions import Fraction
from io import BytesIO

import av
import numpy as np
import pytest

from tests.conftest import AUTH

PATH = "/v1/enterprise/media/transcode-video"


def make_clip(mime: str, *, with_audio: bool = False, long: bool = False) -> bytes:
    original = BytesIO()
    container, codec = ("mp4", "libx264") if mime == "video/mp4" else ("webm", "libvpx-vp9")
    with av.open(original, mode="w", format=container) as output:
        video = output.add_stream(codec, rate=10)
        video.width, video.height, video.pix_fmt = 160, 90, "yuv420p"
        video.codec_context.thread_count = 1
        output.metadata["title"] = "internal jobsite fixture"
        audio = output.add_stream("aac", rate=48_000) if with_audio else None
        if audio is not None:
            audio.layout = "mono"
        for index in ([0, 610] if long else range(10)):
            pixels = np.zeros((90, 160, 3), dtype=np.uint8)
            pixels[:, :65, 0] = 50 + index % 100
            frame = av.VideoFrame.from_ndarray(pixels, format="rgb24")
            frame.pts = index
            frame.time_base = Fraction(1, 10)
            for packet in video.encode(frame):
                output.mux(packet)
            if audio is not None:
                samples = np.full((1, 4800), 0.015, dtype=np.float32)
                sound = av.AudioFrame.from_ndarray(samples, format="fltp", layout="mono")
                sound.sample_rate = 48_000
                sound.time_base = Fraction(1, 48_000)
                sound.pts = index * 4800
                for packet in audio.encode(sound):
                    output.mux(packet)
        for packet in video.encode():
            output.mux(packet)
        if audio is not None:
            for packet in audio.encode():
                output.mux(packet)
    return original.getvalue()


@pytest.mark.parametrize("mime,has_audio", [("video/mp4", True), ("video/webm", False)])
def test_transcodes_real_jobsite_video_to_playable_mp4(client, mime, has_audio):
    original = make_clip(mime, with_audio=has_audio)
    response = client.post(PATH, content=original, headers={**AUTH, "Content-Type": mime})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "video/mp4"
    assert response.headers["cache-control"] == "no-store"
    assert 900 <= int(response.headers["x-video-duration-ms"]) <= 1100
    assert response.headers["x-video-width"] == "160"
    assert response.headers["x-video-height"] == "90"
    assert response.content != original
    with av.open(BytesIO(response.content)) as playback:
        assert playback.streams.video[0].codec_context.name == "h264"
        assert "title" not in playback.metadata
        assert len(playback.streams.audio) == int(has_audio)
        assert len(list(playback.decode(video=0))) == 10
    if has_audio:
        with av.open(BytesIO(response.content)) as playback:
            assert playback.streams.audio[0].codec_context.name == "aac"
            assert sum(frame.samples for frame in playback.decode(audio=0)) >= 48_000


def test_rejects_corrupt_and_over_duration_jobsite_videos(client):
    headers = {**AUTH, "Content-Type": "video/mp4"}
    corrupt = client.post(PATH, content=b"broken", headers=headers)
    assert corrupt.status_code == 422
    assert corrupt.json()["code"] == "video_rejected"
    too_long = client.post(PATH, content=make_clip("video/mp4", long=True), headers=headers)
    assert too_long.status_code == 422
    assert "60 seconds" in too_long.json()["detail"]


def test_jobsite_video_service_requires_the_internal_token(client):
    response = client.post(PATH, content=b"video", headers={"Content-Type": "video/mp4"})
    assert response.status_code == 401
    denied_type = client.post(PATH, content=b"other", headers={**AUTH, "Content-Type": "text/plain"})
    assert denied_type.status_code == 415

"""Bounded in-memory normalization for scanned jobsite video originals."""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from io import BytesIO
from math import isfinite
from time import monotonic

import av

MAX_VIDEO_BYTES = 25 * 1024 * 1024
MAX_VIDEO_DURATION_MS = 60_000
MAX_VIDEO_WIDTH = 1280
MAX_VIDEO_HEIGHT = 1280
_MAX_INPUT_PIXELS = 4096 * 2160
_MAX_VIDEO_FRAMES = 3600
_MAX_AUDIO_FRAMES = 6000
_WORK_SECONDS = 45
_AUDIO_RATE = 48_000
_VIDEO_TIMEBASE = Fraction(1, 1000)
_INPUT_FORMATS = {"video/mp4": "mov", "video/webm": "matroska"}


class VideoRejected(ValueError):
    """The source or its normalized rendition exceeds a media policy."""


class VideoProcessingTimeout(RuntimeError):
    """A transient processing limit was reached."""


@dataclass(frozen=True)
class TranscodedVideo:
    video: bytes
    duration_ms: int
    width: int
    height: int


class _BoundedOutput(BytesIO):
    def write(self, data: bytes) -> int:
        if self.tell() + len(data) > MAX_VIDEO_BYTES:
            raise VideoRejected("The normalized video would exceed the size limit.")
        return super().write(data)


def _milliseconds(timestamp: float | None, origin: float, fallback: int) -> int:
    if timestamp is None or not isfinite(timestamp):
        return fallback
    return max(0, round((timestamp - origin) * 1000))


def _output_size(width: int, height: int) -> tuple[int, int]:
    if width < 2 or height < 2 or width * height > _MAX_INPUT_PIXELS:
        raise VideoRejected("The video frame size is unsupported.")
    scale = min(1.0, MAX_VIDEO_WIDTH / width, MAX_VIDEO_HEIGHT / height)
    return max(2, int(width * scale) // 2 * 2), max(2, int(height * scale) // 2 * 2)


def _duration_limit(ms: int) -> None:
    if ms > MAX_VIDEO_DURATION_MS:
        raise VideoRejected("Jobsite videos may be up to 60 seconds long.")


def transcode_video(data: bytes, mime_type: str) -> TranscodedVideo:
    source_format = _INPUT_FORMATS.get(mime_type)
    if not source_format:
        raise VideoRejected("Choose an MP4 or WebM jobsite video.")
    if not data or len(data) > MAX_VIDEO_BYTES:
        raise VideoRejected("The video is empty or exceeds the size limit.")
    start = monotonic()
    output = _BoundedOutput()
    try:
        with av.open(
            BytesIO(data),
            mode="r",
            format=source_format,
            container_options={"protocol_whitelist": "none", "enable_drefs": "0"},
            timeout=(5, 10),
        ) as incoming:
            if len(incoming.streams.video) != 1 or len(incoming.streams.audio) > 1:
                raise VideoRejected("Use a video with one picture track and at most one audio track.")
            source_video = incoming.streams.video[0]
            source_audio = incoming.streams.audio[0] if incoming.streams.audio else None
            width, height = _output_size(source_video.width, source_video.height)
            origin = (incoming.start_time or 0) / av.time_base
            duration_ms = round((incoming.duration or 0) * 1000 / av.time_base)
            _duration_limit(duration_ms)
            source_video.codec_context.thread_count = 1
            source_video.codec_context.options = {"max_pixels": str(_MAX_INPUT_PIXELS)}
            nominal_rate = float(source_video.average_rate or source_video.guessed_rate or 30)
            output_rate = min(60, max(1, round(nominal_rate)))
            frame_ms = max(1, round(1000 / output_rate))
            input_streams = [source_video]
            if source_audio is not None:
                source_audio.codec_context.thread_count = 1
                input_streams.append(source_audio)

            # Reserve room at the start for the seek table without reopening the output as a file.
            with av.open(output, mode="w", format="mp4", options={"moov_size": "262144"}) as outgoing:
                video = outgoing.add_stream("libx264", rate=output_rate)
                video.width, video.height = width, height
                video.pix_fmt = "yuv420p"
                video.codec_context.time_base = _VIDEO_TIMEBASE
                video.codec_context.thread_count = 1
                video.options = {"preset": "veryfast", "crf": "26"}
                audio = None
                resampler = None
                if source_audio is not None:
                    layout = "stereo" if source_audio.codec_context.channels > 1 else "mono"
                    audio = outgoing.add_stream("aac", rate=_AUDIO_RATE)
                    audio.layout = layout
                    audio.bit_rate = 96_000
                    resampler = av.AudioResampler(
                        format="fltp", layout=layout, rate=_AUDIO_RATE, frame_size=1024, threads=1,
                    )

                video_frames = 0
                audio_frames = 0
                last_video_ms = -1
                audio_offset = None
                audio_samples = 0

                def send_audio(frames: list[av.AudioFrame]) -> None:
                    nonlocal audio_samples
                    if audio is None or audio_offset is None:
                        return
                    for frame in frames:
                        frame.time_base = Fraction(1, _AUDIO_RATE)
                        frame.pts = audio_offset + audio_samples
                        audio_samples += frame.samples
                        for packet in audio.encode(frame):
                            outgoing.mux(packet)

                for packet in incoming.demux(*input_streams):
                    if monotonic() - start > _WORK_SECONDS:
                        raise VideoProcessingTimeout("Video processing exceeded its time budget.")
                    for frame in packet.decode():
                        if isinstance(frame, av.VideoFrame):
                            video_frames += 1
                            if video_frames > _MAX_VIDEO_FRAMES:
                                raise VideoRejected("The video exceeds the supported frame limit.")
                            _output_size(frame.width, frame.height)
                            timestamp = _milliseconds(frame.time, origin, last_video_ms + frame_ms)
                            timestamp = max(last_video_ms + 1, timestamp)
                            frame_duration = (
                                round(frame.duration * float(frame.time_base) * 1000)
                                if frame.duration and frame.time_base else frame_ms
                            )
                            duration_ms = max(duration_ms, timestamp + max(1, frame_duration))
                            _duration_limit(duration_ms)
                            last_video_ms = timestamp
                            normalized = frame.reformat(width=width, height=height, format="yuv420p")
                            normalized.pts = timestamp
                            normalized.time_base = _VIDEO_TIMEBASE
                            for encoded in video.encode(normalized):
                                outgoing.mux(encoded)
                        elif isinstance(frame, av.AudioFrame) and resampler is not None:
                            audio_frames += 1
                            if audio_frames > _MAX_AUDIO_FRAMES or frame.sample_rate <= 0:
                                raise VideoRejected("The audio exceeds the supported frame limit.")
                            timestamp = _milliseconds(frame.time, origin, 0)
                            duration_ms = max(duration_ms, timestamp + round(frame.samples * 1000 / frame.sample_rate))
                            _duration_limit(duration_ms)
                            if audio_offset is None:
                                audio_offset = round(timestamp * _AUDIO_RATE / 1000)
                            frame.pts = None
                            send_audio(resampler.resample(frame))

                if not video_frames:
                    raise VideoRejected("The uploaded file contains no decodable picture.")
                for encoded in video.encode():
                    outgoing.mux(encoded)
                if audio is not None and resampler is not None and audio_offset is not None:
                    send_audio(resampler.resample(None))
                    _duration_limit(round((audio_offset + audio_samples) * 1000 / _AUDIO_RATE))
                    for encoded in audio.encode():
                        outgoing.mux(encoded)
    except av.error.InvalidDataError as error:
        raise VideoRejected("The original could not be decoded as the supplied video format.") from error

    return TranscodedVideo(output.getvalue(), duration_ms, width, height)

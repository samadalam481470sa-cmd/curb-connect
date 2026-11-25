"""Private service endpoint for transcoding a scanned jobsite video."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request, Response
from starlette.concurrency import run_in_threadpool

from app.auth import require_service_token
from app.media.video import (
    MAX_VIDEO_BYTES,
    VideoProcessingTimeout,
    VideoRejected,
    transcode_video,
)
from app.problems import VisionProblem
from app.settings import Settings


def jobsite_video_routes(settings: Settings) -> APIRouter:
    router = APIRouter()
    capacity = asyncio.Semaphore(1)

    @router.post(
        "/v1/enterprise/media/transcode-video",
        dependencies=[Depends(require_service_token)],
        response_class=Response,
        responses={200: {"content": {"video/mp4": {}}}},
    )
    async def transcode_jobsite_video(request: Request) -> Response:
        mime_type = request.headers.get("content-type", "").partition(";")[0].strip().lower()
        if mime_type not in ("video/mp4", "video/webm"):
            raise VisionProblem(415, "unsupported_media_type", "Choose an MP4 or WebM jobsite video.")
        try:
            await asyncio.wait_for(capacity.acquire(), timeout=settings.queue_timeout_seconds)
        except TimeoutError as error:
            raise VisionProblem(503, "worker_busy", "The video worker is at capacity.", retry_after_seconds=2) from error
        try:
            original = await request.body()
            if len(original) > min(settings.max_upload_bytes, MAX_VIDEO_BYTES):
                raise VisionProblem(413, "payload_too_large", "The video exceeds the upload size limit.")
            try:
                result = await run_in_threadpool(transcode_video, original, mime_type)
            except VideoRejected as error:
                raise VisionProblem(422, "video_rejected", str(error)) from error
            except VideoProcessingTimeout as error:
                raise VisionProblem(503, "video_processing_timeout", str(error), retry_after_seconds=2) from error
        finally:
            capacity.release()

        return Response(
            content=result.video,
            media_type="video/mp4",
            headers={
                "X-Video-Duration-Ms": str(result.duration_ms),
                "X-Video-Width": str(result.width),
                "X-Video-Height": str(result.height),
                "X-Content-Type-Options": "nosniff",
            },
        )

    return router

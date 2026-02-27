from fastapi import APIRouter, Query
from typing import List, Dict, Any
from . import recordings_service

router = APIRouter(prefix="/recordings", tags=["Recordings"])

@router.get("/list")
async def list_recordings(limit: int = Query(50, ge=1, le=200)):
    """Returns a list of recent call recordings from the server."""
    return recordings_service.get_recent_recordings(limit=limit)

@router.get("/stream/{filename}")
async def stream_recording(filename: str):
    """Streams a specific recording file."""
    return recordings_service.stream_recording(filename)

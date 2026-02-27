import os
import glob
from typing import List, Dict, Any
from datetime import datetime
from fastapi import HTTPException
from fastapi.responses import FileResponse

# Default path - should be configurable via env or volume mount
RECORDINGS_DIR = os.getenv("RECORDINGS_PATH", "/var/spool/asterisk/monitor")

# Normalize path for the current OS (handles Z:\ or /var/...)
RECORDINGS_DIR = os.path.abspath(RECORDINGS_DIR)

def get_recent_recordings(limit: int = 50) -> List[Dict[str, Any]]:
    """
    Scans the recordings directory and returns metadata for recent recordings.
    """
    if not os.path.exists(RECORDINGS_DIR):
        print(f"[RECORDS] Warning: Recordings directory not found: {RECORDINGS_DIR}")
        return []

    # Get all .wav and .mp3 files
    files = glob.glob(os.path.join(RECORDINGS_DIR, "*.[wm][ap][v3]"))
    
    recordings = []
    for f in files:
        stats = os.stat(f)
        filename = os.path.basename(f)
        
        # Basic parsing: usually formatted as uniqueid.wav or q-queue-id.wav
        # We'll just provide the filename and let the frontend/user match it
        recordings.append({
            "filename": filename,
            "size": stats.st_size,
            "created_at": datetime.fromtimestamp(stats.st_mtime).isoformat(),
            "path": f
        })

    # Sort by mtime descending
    recordings.sort(key=lambda x: x["created_at"], reverse=True)
    return recordings[:limit]

def stream_recording(filename: str):
    """
    Returns a FileResponse for streaming a recording.
    """
    # Security check: prevent directory traversal
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(RECORDINGS_DIR, safe_filename)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Recording not found")

    return FileResponse(
        file_path, 
        media_type="audio/wav", 
        filename=safe_filename
    )

"""
Voicemail API Routes
--------------------
REST endpoints for the voicemail management system.
"""

from fastapi import APIRouter, Query, HTTPException
from typing import List, Dict, Any, Optional
from . import voicemail_service

router = APIRouter(prefix="/voicemails", tags=["Voicemails"])


@router.get("/mailboxes")
async def list_mailboxes():
    """Return all configured voicemail mailboxes."""
    return voicemail_service.get_mailboxes()


@router.get("/{mailbox}/folders")
async def list_folders(
    mailbox: str,
    context: str = Query("default", description="Voicemail context"),
):
    """Return all folders and their message counts for a mailbox."""
    return voicemail_service.get_folders_for_mailbox(mailbox, context)


@router.get("/{mailbox}/messages")
async def list_messages(
    mailbox: str,
    folder: str = Query("INBOX", description="Folder name (INBOX, Old, etc.)"),
    context: str = Query("default", description="Voicemail context"),
):
    """Return all voicemail messages for a mailbox in a specific folder."""
    return voicemail_service.get_messages(mailbox, context, folder)


@router.get("/{mailbox}/count")
async def message_count(
    mailbox: str,
    context: str = Query("default"),
):
    """Get new/old/total message counts for a mailbox."""
    return voicemail_service.get_message_count(mailbox, context)


@router.get("/{mailbox}/stream/{folder}/{msgnum}")
async def stream_message(
    mailbox: str,
    folder: str,
    msgnum: int,
    context: str = Query("default"),
):
    """Stream a voicemail audio file."""
    return voicemail_service.stream_message(mailbox, folder, msgnum, context)


@router.delete("/{mailbox}/messages/{folder}/{msgnum}")
async def delete_message(
    mailbox: str,
    folder: str,
    msgnum: int,
    context: str = Query("default"),
):
    """Delete a voicemail message."""
    success = voicemail_service.delete_message(mailbox, folder, msgnum, context)
    if not success:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"status": "deleted", "mailbox": mailbox, "folder": folder, "msgnum": msgnum}


@router.post("/{mailbox}/move")
async def move_message(
    mailbox: str,
    from_folder: str = Query(..., description="Source folder"),
    to_folder: str = Query(..., description="Destination folder"),
    msgnum: int = Query(..., description="Message number"),
    context: str = Query("default"),
):
    """
    Move a voicemail between folders.
    Use this for 'Mark as Read' (INBOX -> Old) or 'Mark as New' (Old -> INBOX).
    """
    success = voicemail_service.move_message(
        mailbox, from_folder, to_folder, msgnum, context
    )
    if not success:
        raise HTTPException(status_code=404, detail="Message not found or move failed")
    return {
        "status": "moved",
        "mailbox": mailbox,
        "from": from_folder,
        "to": to_folder,
        "msgnum": msgnum,
    }


@router.post("/{mailbox}/folders")
async def create_folder(
    mailbox: str,
    folder_name: str = Query(..., description="Name for the new folder"),
    context: str = Query("default"),
):
    """Create a new custom voicemail folder."""
    return voicemail_service.create_folder(mailbox, folder_name, context)


@router.delete("/{mailbox}/folders/{folder_name}")
async def delete_folder(
    mailbox: str,
    folder_name: str,
    context: str = Query("default"),
):
    """Delete a custom voicemail folder (must be empty, cannot delete protected folders)."""
    voicemail_service.delete_folder(mailbox, folder_name, context)
    return {"status": "deleted", "folder": folder_name}


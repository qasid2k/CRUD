"""
Voicemail Service
-----------------
Provides business logic for the voicemail system.
Reads voicemail messages from the Asterisk database (voicemail_messages table)
and serves audio from the filesystem (/var/spool/asterisk/voicemail/).
Supports: list, read/unread, move between folders, delete, stream audio.
"""

import os
import glob
import shutil
from typing import Any, Dict, List, Optional
from datetime import datetime

from fastapi import HTTPException
from fastapi.responses import FileResponse
from sqlmodel import Session, text

from ..database import engine, get_session

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# Asterisk stores voicemail audio files here by default
VOICEMAIL_BASE_DIR = os.getenv(
    "VOICEMAIL_PATH", "/var/spool/asterisk/voicemail"
)

# Default Asterisk voicemail folders (always shown even if empty)
DEFAULT_FOLDERS = ["INBOX", "Old", "Urgent"]

# Reserved folder names that cannot be deleted
PROTECTED_FOLDERS = {"INBOX", "Old", "Urgent", "Tmp"}

# Characters not allowed in folder names (filesystem safety)
_UNSAFE_CHARS = set('/\\..\0')


def _is_valid_folder_name(name: str) -> bool:
    """Check if a folder name is safe for use on the filesystem."""
    if not name or len(name) > 40:
        return False
    if name.startswith('.') or name.startswith(' '):
        return False
    if any(c in _UNSAFE_CHARS for c in name):
        return False
    return True


def _discover_folders(context: str, mailbox: str) -> List[str]:
    """
    Dynamically discover all folders for a mailbox by scanning the filesystem.
    Returns a combined list of default folders + any custom folders found on disk.
    """
    mailbox_path = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox)
    found_folders = set(DEFAULT_FOLDERS)  # Always include defaults

    if os.path.exists(mailbox_path):
        for entry in os.listdir(mailbox_path):
            entry_path = os.path.join(mailbox_path, entry)
            if os.path.isdir(entry_path) and not entry.startswith('.'):
                found_folders.add(entry)

    # Sort: defaults first (in order), then custom folders alphabetically
    default_order = [f for f in DEFAULT_FOLDERS if f in found_folders]
    custom_order = sorted(f for f in found_folders if f not in DEFAULT_FOLDERS)
    return default_order + custom_order


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_vm_audio_path(context: str, mailbox: str, folder: str, msgnum: int) -> Optional[str]:
    """
    Build the filesystem path to a voicemail audio file.
    Asterisk stores them at:
      /var/spool/asterisk/voicemail/<context>/<mailbox>/<folder>/msg<NNNN>.wav
    """
    msg_filename = f"msg{msgnum:04d}.wav"
    path = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox, folder, msg_filename)
    if os.path.exists(path):
        return path

    # Try .WAV (Asterisk sometimes uses uppercase)
    path_upper = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox, folder, f"msg{msgnum:04d}.WAV")
    if os.path.exists(path_upper):
        return path_upper

    # Try wav49 format
    path_wav49 = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox, folder, f"msg{msgnum:04d}.wav49")
    if os.path.exists(path_wav49):
        return path_wav49

    return None


def _scan_voicemail_files(context: str, mailbox: str, folder: str) -> List[Dict[str, Any]]:
    """
    Scan filesystem for voicemail files when DB table doesn't exist.
    Falls back to reading .txt metadata files alongside .wav files.
    """
    folder_path = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox, folder)
    if not os.path.exists(folder_path):
        return []

    messages = []
    # Find all .txt metadata files
    txt_files = sorted(glob.glob(os.path.join(folder_path, "msg*.txt")))

    for txt_file in txt_files:
        basename = os.path.splitext(os.path.basename(txt_file))[0]
        msgnum_str = basename.replace("msg", "")
        try:
            msgnum = int(msgnum_str)
        except ValueError:
            continue

        metadata: Dict[str, str] = {}
        try:
            with open(txt_file, "r") as f:
                for line in f:
                    line = line.strip()
                    if "=" in line:
                        key, _, value = line.partition("=")
                        metadata[key.strip()] = value.strip()
        except Exception:
            pass

        wav_path = None
        for ext in [".wav", ".WAV", ".wav49", ".gsm"]:
            candidate = os.path.join(folder_path, basename + ext)
            if os.path.exists(candidate):
                wav_path = candidate
                break

        duration = int(metadata.get("duration", "0"))
        origtime = metadata.get("origtime", "0")
        callerid = metadata.get("callerid", "Unknown")
        msg_id = metadata.get("msg_id", "")

        try:
            origtime_dt = datetime.fromtimestamp(int(origtime)).isoformat()
        except (ValueError, OSError):
            origtime_dt = datetime.now().isoformat()

        messages.append({
            "id": msgnum,
            "msgnum": msgnum,
            "dir": folder_path,
            "context": context,
            "mailbox": mailbox,
            "folder": folder,
            "callerid": callerid,
            "origtime": origtime_dt,
            "duration": duration,
            "msg_id": msg_id,
            "has_audio": wav_path is not None,
            "flag": "F" if wav_path else "O" # F for File, O for ODBC (placeholder)
        })

    return messages


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_mailboxes() -> List[Dict[str, Any]]:
    """
    Return all configured voicemail mailboxes from the 'voicemail' table.
    Each row represents one agent/extension's mailbox settings.
    """
    try:
        with Session(engine) as session:
            result = session.execute(text(
                "SELECT context, mailbox, fullname, email "
                "FROM voicemail ORDER BY mailbox"
            ))
            return [dict(row._mapping) for row in result]
    except Exception as e:
        print(f"[Voicemail] Error fetching mailboxes: {e}")
        return []


def get_folders_for_mailbox(mailbox: str, context: str = "default") -> List[Dict[str, Any]]:
    """
    Return the list of voicemail folders and the count of messages in each.
    Dynamically discovers folders from the filesystem.
    """
    folders = []
    mailbox_path = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox)
    discovered = _discover_folders(context, mailbox)

    for folder_name in discovered:
        folder_path = os.path.join(mailbox_path, folder_name)
        count = 0
        if os.path.exists(folder_path):
            count = len(glob.glob(os.path.join(folder_path, "msg*.txt")))

        folders.append({
            "name": folder_name,
            "count": count,
            "is_custom": folder_name not in DEFAULT_FOLDERS,
            "is_protected": folder_name in PROTECTED_FOLDERS,
        })

    return folders


def get_messages(
    mailbox: str,
    context: str = "default",
    folder: str = "INBOX",
) -> List[Dict[str, Any]]:
    """
    Get all voicemail messages for a specific mailbox and folder.
    First tries the database (voicemail_messages table), then falls back
    to filesystem scanning.
    """
    # Validate folder name for safety
    if not _is_valid_folder_name(folder):
        folder = "INBOX"

    # Strategy 1: Try the database table
    try:
        with Session(engine) as session:
            result = session.execute(
                text(
                    "SELECT id, dir, msgnum, context, callerid, origtime, "
                    "duration, mailboxuser, mailboxcontext, msg_id, flag "
                    "FROM voicemail_messages "
                    "WHERE mailboxuser = :mailbox "
                    "AND mailboxcontext = :context "
                    "AND dir = :folder_dir "
                    "ORDER BY origtime DESC"
                ),
                {
                    "mailbox": mailbox,
                    "context": context,
                    "folder_dir": os.path.join(VOICEMAIL_BASE_DIR, context, mailbox, folder),
                },
            )
            rows = [dict(row._mapping) for row in result]

            if rows:
                # Enrich with audio availability
                for row in rows:
                    row["folder"] = folder
                    row["mailbox"] = mailbox
                    
                    # Check filesystem first
                    fs_path = _get_vm_audio_path(context, mailbox, folder, row.get("msgnum", 0))
                    # Or check if DB might have it (implied by table existence and lack of file)
                    # We'll set has_audio to True if it's in DB or on FS
                    row["has_audio"] = (fs_path is not None)
                    
                    # Use a custom flag to indicate where audio is (for internal use)
                    row["audio_source"] = "filesystem" if fs_path else "database"
                    
                    # If we don't have a file, but the row exists, assume audio is in DB blob
                    # (Asterisk ODBC voicemail uses 'recording' column)
                    if not row["has_audio"]:
                        # We don't fetch the blob here for performance, just mark as available
                        row["has_audio"] = True

                    origtime = row.get("origtime", "")
                    if origtime and str(origtime).isdigit():
                        try:
                            row["origtime"] = datetime.fromtimestamp(
                                int(origtime)
                            ).isoformat()
                        except (ValueError, OSError):
                            pass

                return rows
    except Exception as e:
        print(f"[Voicemail] DB query failed (falling back to filesystem): {e}")

    # Strategy 2: Filesystem scan
    return _scan_voicemail_files(context, mailbox, folder)


def stream_message(
    mailbox: str,
    folder: str,
    msgnum: int,
    context: str = "default",
) -> Any:
    """Stream a voicemail audio file from filesystem or database BLOB."""
    if not _is_valid_folder_name(folder):
        raise HTTPException(status_code=400, detail=f"Invalid folder name: {folder}")

    # 1. Try filesystem first
    audio_path = _get_vm_audio_path(context, mailbox, folder, msgnum)
    if audio_path:
        media_type = "audio/wav"
        if audio_path.endswith(".wav49"):
            media_type = "audio/x-wav"
        return FileResponse(
            audio_path,
            media_type=media_type,
            filename=f"voicemail_{mailbox}_{folder}_{msgnum}.wav",
        )

    # 2. Try database BLOB
    try:
        from fastapi import Response
        with Session(engine) as session:
            folder_dir = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox, folder)
            result = session.execute(
                text("SELECT recording FROM voicemail_messages WHERE mailboxuser = :u AND dir = :d AND msgnum = :m"),
                {"u": mailbox, "d": folder_dir, "m": msgnum}
            ).first()
            
            if result and result.recording:
                return Response(
                    content=result.recording,
                    media_type="audio/wav",
                    headers={"Content-Disposition": f"attachment; filename=voicemail_{mailbox}_{msgnum}.wav"}
                )
    except Exception as e:
        print(f"[Voicemail] DB streaming error: {e}")

    raise HTTPException(
        status_code=404,
        detail=f"Audio not found for mailbox={mailbox}, msg={msgnum} (checked disk and DB)",
    )


def delete_message(
    mailbox: str,
    folder: str,
    msgnum: int,
    context: str = "default",
) -> bool:
    """
    Delete a voicemail message.
    Removes from database (if present) and filesystem.
    Returns True if either DB row or FS file was deleted.
    """
    db_deleted = False
    # 1. Delete from DB
    try:
        with Session(engine) as session:
            result = session.execute(
                text(
                    "DELETE FROM voicemail_messages "
                    "WHERE mailboxuser = :mailbox "
                    "AND mailboxcontext = :context "
                    "AND msgnum = :msgnum "
                    "AND dir = :folder_dir"
                ),
                {
                    "mailbox": mailbox,
                    "context": context,
                    "msgnum": msgnum,
                    "folder_dir": os.path.join(VOICEMAIL_BASE_DIR, context, mailbox, folder),
                },
            )
            session.commit()
            if result.rowcount > 0:
                db_deleted = True
    except Exception as e:
        print(f"[Voicemail] DB delete error: {e}")

    # 2. Delete from filesystem
    folder_path = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox, folder)
    basename = f"msg{msgnum:04d}"
    fs_deleted = False

    for ext in [".wav", ".WAV", ".wav49", ".txt", ".gsm"]:
        fpath = os.path.join(folder_path, basename + ext)
        if os.path.exists(fpath):
            try:
                os.remove(fpath)
                fs_deleted = True
            except OSError as e:
                print(f"[Voicemail] Failed to delete {fpath}: {e}")

    # 3. Synchronize re-numbering
    # This keeps Asterisk (filesystem) and DB msgnums consistent
    _renumber_messages(context, mailbox, folder)

    return db_deleted or fs_deleted


def move_message(
    mailbox: str,
    from_folder: str,
    to_folder: str,
    msgnum: int,
    context: str = "default",
) -> bool:
    """
    Move a voicemail message between folders (e.g. INBOX -> Old).
    This is how 'mark as read' works: move from INBOX to Old.
    """
    if not _is_valid_folder_name(from_folder) or not _is_valid_folder_name(to_folder):
        raise HTTPException(status_code=400, detail="Invalid folder name")

    if from_folder == to_folder:
        return True

    src_folder = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox, from_folder)
    dst_folder = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox, to_folder)

    # Ensure destination folder exists
    os.makedirs(dst_folder, exist_ok=True)

    # Find the next available msgnum in destination
    existing = sorted(glob.glob(os.path.join(dst_folder, "msg*.txt")))
    next_num = len(existing)

    basename_src = f"msg{msgnum:04d}"
    basename_dst = f"msg{next_num:04d}"

    moved_any = False
    for ext in [".wav", ".WAV", ".wav49", ".txt", ".gsm"]:
        src_path = os.path.join(src_folder, basename_src + ext)
        dst_path = os.path.join(dst_folder, basename_dst + ext)
        if os.path.exists(src_path):
            try:
                os.rename(src_path, dst_path)
                moved_any = True
            except OSError as e:
                print(f"[Voicemail] Failed to move {src_path} -> {dst_path}: {e}")

    # Update database if table exists
    try:
        with Session(engine) as session:
            new_dir = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox, to_folder)
            session.execute(
                text(
                    "UPDATE voicemail_messages "
                    "SET dir = :new_dir, msgnum = :new_msgnum "
                    "WHERE mailboxuser = :mailbox "
                    "AND mailboxcontext = :context "
                    "AND msgnum = :old_msgnum "
                    "AND dir = :old_dir"
                ),
                {
                    "new_dir": new_dir,
                    "new_msgnum": next_num,
                    "mailbox": mailbox,
                    "context": context,
                    "old_msgnum": msgnum,
                    "old_dir": os.path.join(VOICEMAIL_BASE_DIR, context, mailbox, from_folder),
                },
            )
            session.commit()
    except Exception as e:
        print(f"[Voicemail] DB update warning during move: {e}")

    # Re-number source folder
    _renumber_messages(context, mailbox, from_folder)

    return moved_any


def get_message_count(mailbox: str, context: str = "default") -> Dict[str, int]:
    """
    Get total and new (INBOX) message counts for a mailbox.
    """
    inbox_path = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox, "INBOX")
    old_path = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox, "Old")

    new_count = 0
    old_count = 0

    if os.path.exists(inbox_path):
        new_count = len(glob.glob(os.path.join(inbox_path, "msg*.txt")))
    if os.path.exists(old_path):
        old_count = len(glob.glob(os.path.join(old_path, "msg*.txt")))

    return {
        "mailbox": mailbox,
        "new": new_count,
        "old": old_count,
        "total": new_count + old_count,
    }


def create_folder(
    mailbox: str,
    folder_name: str,
    context: str = "default",
) -> Dict[str, Any]:
    """
    Create a new custom voicemail folder for a mailbox.
    Creates the directory on the filesystem.
    """
    if not _is_valid_folder_name(folder_name):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid folder name: '{folder_name}'. Use only letters, numbers, spaces, hyphens, and underscores.",
        )

    mailbox_path = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox)
    folder_path = os.path.join(mailbox_path, folder_name)

    if os.path.exists(folder_path):
        raise HTTPException(
            status_code=409,
            detail=f"Folder '{folder_name}' already exists.",
        )

    try:
        os.makedirs(folder_path, exist_ok=True)
    except OSError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create folder: {e}",
        )

    return {
        "name": folder_name,
        "count": 0,
        "is_custom": folder_name not in DEFAULT_FOLDERS,
        "is_protected": False,
    }


def delete_folder(
    mailbox: str,
    folder_name: str,
    context: str = "default",
) -> bool:
    """
    Delete a custom voicemail folder.
    Protected folders cannot be deleted.
    Cleans up database records first, then removes the directory.
    """
    folder_name_lower = folder_name.lower()
    protected_lower = {f.lower() for f in PROTECTED_FOLDERS}
    
    if folder_name_lower in protected_lower:
        raise HTTPException(
            status_code=403,
            detail=f"Cannot delete protected system folder '{folder_name}'.",
        )

    mailbox_path = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox)
    folder_path = os.path.join(mailbox_path, folder_name)

    # 1. Delete all message records from database for this folder
    try:
        with Session(engine) as session:
            # We match by exact dir path
            session.execute(
                text(
                    "DELETE FROM voicemail_messages "
                    "WHERE mailboxuser = :mailbox "
                    "AND mailboxcontext = :context "
                    "AND dir = :folder_path"
                ),
                {
                    "mailbox": mailbox,
                    "context": context,
                    "folder_path": folder_path,
                },
            )
            session.commit()
    except Exception as e:
        print(f"[Voicemail] DB cleanup error during folder delete: {e}")

    # 2. Delete from filesystem
    # If the folder exists, remove it and all its contents
    if os.path.exists(folder_path):
        try:
            if os.path.isdir(folder_path):
                shutil.rmtree(folder_path)
            else:
                os.remove(folder_path)
        except OSError as e:
            print(f"[Voicemail] OS Error deleting folder {folder_path}: {e}")
            raise HTTPException(status_code=500, detail=f"Filesystem error: Could not remove folder.")
    
    return True


# ---------------------------------------------------------------------------
# Internal Helpers
# ---------------------------------------------------------------------------

def _renumber_messages(context: str, mailbox: str, folder: str):
    """
    Renumber remaining messages sequentially and sync the DB with filesystem.
    """
    folder_path = os.path.join(VOICEMAIL_BASE_DIR, context, mailbox, folder)
    if not os.path.exists(folder_path):
        return

    # 1. Get current files on disk
    txt_files = sorted(glob.glob(os.path.join(folder_path, "msg*.txt")))
    
    for new_idx, txt_file in enumerate(txt_files):
        old_basename = os.path.splitext(os.path.basename(txt_file))[0]
        new_basename = f"msg{new_idx:04d}"
        old_msgnum = int(old_basename.replace("msg", ""))

        if old_basename != new_basename:
            # Rename files on disk
            for ext in [".wav", ".WAV", ".wav49", ".txt", ".gsm"]:
                old_path = os.path.join(folder_path, old_basename + ext)
                new_path = os.path.join(folder_path, new_basename + ext)
                if os.path.exists(old_path):
                    try:
                        os.rename(old_path, new_path)
                    except OSError:
                        pass
            
            # Update DB row for this specific message
            try:
                with Session(engine) as session:
                    session.execute(
                        text(
                            "UPDATE voicemail_messages "
                            "SET msgnum = :new_num "
                            "WHERE mailboxuser = :mailbox "
                            "AND dir = :folder_dir "
                            "AND msgnum = :old_num"
                        ),
                        {
                            "new_num": new_idx,
                            "mailbox": mailbox,
                            "folder_dir": folder_path,
                            "old_num": old_msgnum
                        }
                    )
                    session.commit()
            except Exception as e:
                print(f"[Voicemail] Renumber DB error: {e}")

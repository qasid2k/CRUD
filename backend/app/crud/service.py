"""
CRUD Service Layer
------------------
Business logic sitting between the routes and the dynamic repository.
All results are plain dicts (no ORM objects), making serialisation trivial.
"""

from __future__ import annotations

from typing import Any, Dict, List

from fastapi import HTTPException
from sqlmodel import Session

from . import repository
from . import recordings_service


# Table names that are read-only (system logs – should never be edited by users)
READ_ONLY_TABLES = {"queue_log", "cdr"}

# Core PJSIP tables that share the same ID for an extension
PJSIP_SYNC_GROUP = {"ps_endpoints", "ps_auths", "ps_aors"}

# Default values when auto-creating stub rows in related PJSIP tables
PJSIP_DEFAULTS = {
    "ps_endpoints": lambda ext_id: {"id": ext_id, "auth": ext_id, "aors": ext_id, "context": "default"},
    "ps_auths": lambda ext_id: {"id": ext_id, "auth_type": "userpass", "password": "", "username": ext_id},
    "ps_aors": lambda ext_id: {"id": ext_id},
}


def get_available_tables() -> List[str]:
    return repository.list_tables()


def get_schema(table_name: str) -> Dict[str, Any]:
    schema = repository.get_table_schema(table_name)
    if schema is None:
        raise HTTPException(status_code=404, detail="Table not found")
    return schema


def _assert_table_exists(table_name: str):
    """Raise 404 if the table does not exist in the database."""
    if repository.get_table(table_name) is None:
        raise HTTPException(status_code=404, detail="Table not found")


def list_items(table_name: str, skip: int, limit: int, session: Session):
    _assert_table_exists(table_name)
    items = repository.list_items(session, table_name, skip=skip, limit=limit)

    # If it's a call record table, augment with recording presence info
    if table_name.lower() in READ_ONLY_TABLES:
        recording_ids = recordings_service.get_recordings_uniqueids()

        augmented_items = []
        for item_dict in items:
            uid = item_dict.get("uniqueid")
            userfield = (
                item_dict.get("userfield", "").split(".")[0]
                if item_dict.get("userfield")
                else None
            )
            item_dict["has_recording"] = (uid in recording_ids) or (
                userfield in recording_ids
            )
            augmented_items.append(item_dict)

        return augmented_items

    return items


def create_item(table_name: str, data: Dict[str, Any], session: Session):
    _assert_table_exists(table_name)

    if table_name.lower() in READ_ONLY_TABLES:
        raise HTTPException(status_code=403, detail="Table is read-only")

    try:
        new_item = repository.create_item(session, table_name, data)

        # --- PJSIP Auto-Sync Logic ---
        current_table = table_name.lower()
        if current_table in PJSIP_SYNC_GROUP and "id" in data:
            item_id = data["id"]
            for target_table in PJSIP_SYNC_GROUP:
                if target_table == current_table:
                    continue

                # Only sync if the target table exists in the database
                if repository.get_table(target_table) is None:
                    continue

                existing = repository.get_item_by_id(session, target_table, item_id)
                if not existing:
                    stub_data = PJSIP_DEFAULTS.get(target_table, lambda x: {"id": x})(item_id)
                    try:
                        repository.create_item(session, target_table, stub_data)
                    except Exception:
                        pass  # Don't crash main creation if sync fails

        return new_item
    except HTTPException:
        raise
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(e))


def update_item(table_name: str, item_id: str, data: Dict[str, Any], session: Session):
    _assert_table_exists(table_name)

    if table_name.lower() in READ_ONLY_TABLES:
        raise HTTPException(status_code=403, detail="Table is read-only")

    existing = repository.get_item_by_id(session, table_name, item_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Item not found")

    try:
        updated = repository.update_item(session, table_name, item_id, data)
        return updated
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(e))


def delete_item(table_name: str, item_id: str, session: Session):
    _assert_table_exists(table_name)

    if table_name.lower() in READ_ONLY_TABLES:
        raise HTTPException(status_code=403, detail="Table is read-only")

    existing = repository.get_item_by_id(session, table_name, item_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Item not found")

    repository.delete_item(session, table_name, item_id)
    return {"ok": True}

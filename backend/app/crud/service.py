from __future__ import annotations

from typing import Any, Dict, List

from fastapi import HTTPException
from sqlmodel import Session, SQLModel

from . import repository
from . import recordings_service


def get_available_tables() -> List[str]:
    return repository.list_tables()


def get_model_or_404(table_name: str) -> type[SQLModel]:
    model = repository.get_model(table_name)
    if model is None:
        raise HTTPException(status_code=404, detail="Table not found")
    return model


def get_schema(table_name: str) -> Dict[str, Any]:
    model = get_model_or_404(table_name)
    return repository.get_table_schema(model)


def list_items(table_name: str, skip: int, limit: int, session: Session):
    model = get_model_or_404(table_name)
    items = repository.list_items(session, model, skip=skip, limit=limit)
    
    # If it's a call record table, augment with recording presence info
    if table_name.lower() in ["cdr", "queue_log"]:
        # Get a set of uniqueids that have recordings
        # We do this once per batch of items for efficiency
        recording_ids = recordings_service.get_recordings_uniqueids()
        
        # Convert to list of dicts to add the new field
        augmented_items = []
        for item in items:
            # SQLModel to dict
            item_dict = item.model_dump() if hasattr(item, "model_dump") else item.dict()
            
            # Match the uniqueid with a file (either direct match or from userfield)
            uid = item_dict.get("uniqueid")
            userfield = item_dict.get("userfield", "").split(".")[0] if item_dict.get("userfield") else None
            
            # Check if recording exists for this call
            item_dict["has_recording"] = (uid in recording_ids) or (userfield in recording_ids)
            augmented_items.append(item_dict)
            
        return augmented_items
        
    return items


def create_item(table_name: str, data: Dict[str, Any], session: Session):
    model = get_model_or_404(table_name)
    if table_name.lower() in ["queue_log", "cdr"]:
        raise HTTPException(status_code=403, detail="Table is read-only")
    try:
        new_item = repository.create_item(session, model, data)
        
        # --- Start of PJSIP Auto-Sync Logic ---
        # Core PJSIP tables that usually share the same ID for an extension
        pjsip_sync_group = ["ps_endpoints", "ps_auths", "ps_aors", "ps_registrations", "ps_outbound_auths"]
        current_table = table_name.lower()
        
        if current_table in pjsip_sync_group and "id" in data:
            item_id = data["id"]
            for target_table in pjsip_sync_group:
                if target_table == current_table:
                    continue
                
                target_model = repository.get_model(target_table)
                # Only sync if the table exists in our models
                if target_model:
                    existing = repository.get_item_by_id(session, target_model, item_id)
                    if not existing:
                        stub_data = {"id": item_id}
                        
                        # Apply smart defaults for specific tables
                        if target_table == "ps_endpoints":
                            stub_data.update({"auth": item_id, "aors": item_id, "context": "default"})
                        elif target_table == "ps_auths" or target_table == "ps_outbound_auths":
                            stub_data.update({"auth_type": "userpass", "password": "", "username": item_id})
                        
                        try:
                            repository.create_item(session, target_model, stub_data)
                        except Exception:
                            # If a specific sync fails (e.g. missing required field we didn't account for),
                            # we don't want to crash the main creation.
                            pass
        # --- End of PJSIP Auto-Sync Logic ---

        return new_item
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(e))


def update_item(table_name: str, item_id: str, data: Dict[str, Any], session: Session):
    model = get_model_or_404(table_name)
    if table_name.lower() in ["queue_log", "cdr"]:
        raise HTTPException(status_code=403, detail="Table is read-only")
    obj = repository.get_item_by_id(session, model, item_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Item not found")

    try:
        for key, value in data.items():
            if hasattr(obj, key):
                setattr(obj, key, value)
        return repository.save_item(session, obj)
    except Exception as e:  # pragma: no cover - generic safety net
        session.rollback()
        raise HTTPException(status_code=400, detail=str(e))


def delete_item(table_name: str, item_id: str, session: Session):
    model = get_model_or_404(table_name)
    if table_name.lower() in ["queue_log", "cdr"]:
        raise HTTPException(status_code=403, detail="Table is read-only")
    obj = repository.get_item_by_id(session, model, item_id)
    if obj is None:
        raise HTTPException(status_code=404, detail="Item not found")

    repository.delete_item(session, obj)
    return {"ok": True}


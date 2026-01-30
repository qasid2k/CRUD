from fastapi import APIRouter, Depends
from sqlmodel import Session

from ..database import get_session
from .schema import ItemCreate, ItemUpdate
from . import service



from . import queue_status

router = APIRouter()


@router.get("/queues/status")
async def get_queues_status():
    """Returns real-time queue status from Asterisk."""
    return await queue_status.queue_manager.get_queue_status()


@router.get("/{table_name}")
async def read_items(
    table_name: str,
    skip: int = 0,
    limit: int = 100,
    session: Session = Depends(get_session),
):
    return service.list_items(table_name, skip=skip, limit=limit, session=session)


@router.get("/{table_name}/schema")
async def get_table_schema(table_name: str):
    return service.get_schema(table_name)


@router.post("/{table_name}")
async def create_item(
    table_name: str,
    item: ItemCreate,
    session: Session = Depends(get_session),
):
    return service.create_item(table_name, data=item.to_dict(), session=session)


@router.put("/{table_name}/{item_id:path}")
async def update_item(
    table_name: str,
    item_id: str,
    item: ItemUpdate,
    session: Session = Depends(get_session),
):
    return service.update_item(
        table_name, item_id=item_id, data=item.to_dict(), session=session
    )


@router.delete("/{table_name}/{item_id:path}")
async def delete_item(
    table_name: str,
    item_id: str,
    session: Session = Depends(get_session),
):
    return service.delete_item(table_name, item_id=item_id, session=session)


@router.get("/")
async def list_tables():
    """List all available table names."""
    return {"tables": service.get_available_tables()}


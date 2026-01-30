from __future__ import annotations

from typing import Any, Dict, List, Type
import inspect

from sqlmodel import SQLModel, Session, select

from .. import models


_model_cache: Dict[str, Type[SQLModel]] | None = None


def _build_model_cache() -> Dict[str, Type[SQLModel]]:
    cache: Dict[str, Type[SQLModel]] = {}
    for _name, obj in inspect.getmembers(models):
        if (
            inspect.isclass(obj)
            and issubclass(obj, SQLModel)
            and obj is not SQLModel
            and hasattr(obj, "__tablename__")
        ):
            table_name = getattr(obj, "__tablename__").lower()
            cache[table_name] = obj
    return cache


def get_model(table_name: str) -> Type[SQLModel] | None:
    """Return SQLModel class for a given table name (case‑insensitive)."""
    global _model_cache
    if _model_cache is None:
        _model_cache = _build_model_cache()
    return _model_cache.get(table_name.lower())


def list_tables() -> List[str]:
    """Return list of known table names."""
    global _model_cache
    if _model_cache is None:
        _model_cache = _build_model_cache()
    return sorted(_model_cache.keys())


def get_table_schema(model: Type[SQLModel]) -> Dict[str, Any]:
    """Return list of field names and primary keys for the given model."""
    if hasattr(model, "model_fields"):
        fields = list(model.model_fields.keys())
    else:
        fields = list(model.__fields__.keys())
    
    # Get primary key column names
    pk_names = [c.name for c in model.__table__.primary_key.columns]
    
    return {
        "fields": fields,
        "primary_keys": pk_names
    }


def list_items(session: Session, model: Type[SQLModel], skip: int = 0, limit: int = 100):
    statement = select(model).offset(skip).limit(limit)
    return session.exec(statement).all()


def create_item(session: Session, model: Type[SQLModel], data: Dict[str, Any]):
    db_item = model.model_validate(data)
    session.add(db_item)
    session.commit()
    session.refresh(db_item)
    return db_item


def get_item_by_id(session: Session, model: Type[SQLModel], item_id: str):
    """Fetch a single item by primary key, supporting composite keys with ::: separator."""
    pk_columns = model.__table__.primary_key.columns
    
    if len(pk_columns) > 1 and ":::" in item_id:
        # Handle composite primary keys
        parts = item_id.split(":::")
        if len(parts) == len(pk_columns):
            pk_values = []
            for part in parts:
                try:
                    pk_values.append(int(part))
                except (ValueError, TypeError):
                    pk_values.append(part)
            return session.get(model, tuple(pk_values))

    # Single primary key logic
    obj = session.get(model, item_id)
    if obj is not None:
        return obj
    try:
        int_id = int(item_id)
    except (TypeError, ValueError):
        return None
    return session.get(model, int_id)


def save_item(session: Session, obj: SQLModel):
    session.add(obj)
    session.commit()
    session.refresh(obj)
    return obj


def delete_item(session: Session, obj: SQLModel):
    session.delete(obj)
    session.commit()


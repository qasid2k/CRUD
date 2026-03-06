"""
Dynamic Database Repository
----------------------------
Uses SQLAlchemy reflection to auto-discover ALL tables in the connected
database. No hardcoded models needed – works with any Asterisk DB.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from sqlalchemy import MetaData, Table, inspect as sa_inspect
from sqlalchemy import select, insert, update, delete, and_
from sqlmodel import Session

from ..database import engine


# ---------------------------------------------------------------------------
# Reflected metadata cache
# ---------------------------------------------------------------------------
_metadata: MetaData = MetaData()


def _get_metadata() -> MetaData:
    """Return the global metadata object."""
    return _metadata


def invalidate_cache():
    """Clear the reflected metadata cache."""
    global _metadata
    _metadata = MetaData()


# ---------------------------------------------------------------------------
# Table discovery
# ---------------------------------------------------------------------------
def list_tables() -> List[str]:
    """
    Return sorted list of all table names in the database.
    If TABLE_NAMES is defined in .env, it acts as a filter/whitelist.
    """
    # 1. Check if a whitelist is explicitly provided in the environment
    whitelist_raw = os.getenv("TABLE_NAMES")
    if whitelist_raw:
        return [t.strip() for t in whitelist_raw.split(",") if t.strip()]

    # 2. Otherwise, dynamically discover all tables in the current schema
    inspector = sa_inspect(engine)
    return sorted(inspector.get_table_names())


def get_table(table_name: str) -> Optional[Table]:
    """
    Return the SQLAlchemy Table object for a given name.
    Performs case-insensitive lookup and dynamic reflection if needed.
    """
    # 1. Direct hit in cache
    if table_name in _metadata.tables:
        return _metadata.tables[table_name]

    # 2. Case-insensitive search in existing metadata
    for t_name in _metadata.tables:
        if t_name.lower() == table_name.lower():
            return _metadata.tables[t_name]

    # 3. Try to reflect it from the database on-demand
    try:
        # Check if it actually exists in the DB first (handling casing)
        inspector = sa_inspect(engine)
        db_tables = inspector.get_table_names()
        
        actual_name = None
        if table_name in db_tables:
            actual_name = table_name
        else:
            # Case-insensitive search in DB
            for t in db_tables:
                if t.lower() == table_name.lower():
                    actual_name = t
                    break
        
        if actual_name:
            return Table(actual_name, _metadata, autoload_with=engine)
            
    except Exception as e:
        print(f"Error reflecting table {table_name}: {e}")
    
    return None


# ---------------------------------------------------------------------------
# Schema introspection
# ---------------------------------------------------------------------------
def get_table_schema(table_name: str) -> Optional[Dict[str, Any]]:
    """Return field names and primary keys for a table."""
    table = get_table(table_name)
    if table is None:
        return None

    # We use table.columns to get ALL fields defined in the DB
    fields = [c.name for c in table.columns]
    pk_names = [c.name for c in table.primary_key.columns]

    return {
        "fields": fields,
        "primary_keys": pk_names,
    }


# ---------------------------------------------------------------------------
# CRUD operations
# ---------------------------------------------------------------------------
def list_items(
    session: Session,
    table_name: str,
    skip: int = 0,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Return a paginated list of rows as dicts."""
    table = get_table(table_name)
    if table is None:
        return []

    stmt = select(table).offset(skip).limit(limit)
    result = session.execute(stmt)
    return [dict(row._mapping) for row in result]


def create_item(
    session: Session,
    table_name: str,
    data: Dict[str, Any],
) -> Dict[str, Any]:
    """Insert a new row and return the data dict."""
    table = get_table(table_name)
    if table is None:
        raise ValueError(f"Table '{table_name}' not found")

    session.execute(insert(table).values(**data))
    session.commit()
    return data


def _build_pk_conditions(table: Table, item_id: str):
    """Build WHERE conditions for a primary key lookup, supporting composites."""
    pk_columns = list(table.primary_key.columns)

    if not pk_columns:
        return None

    if len(pk_columns) > 1 and ":::" in str(item_id):
        parts = item_id.split(":::")
        if len(parts) != len(pk_columns):
            return None
        conditions = []
        for col, val in zip(pk_columns, parts):
            conditions.append(col == _try_int(val))
        return and_(*conditions)

    # Single primary key – try both string and int
    pk_col = pk_columns[0]
    return pk_col == _try_int(item_id)


def _try_int(value: str):
    """Try to convert a string to int; return original if it fails."""
    try:
        return int(value)
    except (ValueError, TypeError):
        return value


def get_item_by_id(
    session: Session,
    table_name: str,
    item_id: str,
) -> Optional[Dict[str, Any]]:
    """Fetch a single row by primary key."""
    table = get_table(table_name)
    if table is None:
        return None

    condition = _build_pk_conditions(table, item_id)
    if condition is None:
        return None

    result = session.execute(select(table).where(condition)).first()
    return dict(result._mapping) if result else None


def update_item(
    session: Session,
    table_name: str,
    item_id: str,
    data: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Update a row by primary key and return the updated data."""
    table = get_table(table_name)
    if table is None:
        return None

    condition = _build_pk_conditions(table, item_id)
    if condition is None:
        return None

    session.execute(update(table).where(condition).values(**data))
    session.commit()

    # Return the updated row
    return get_item_by_id(session, table_name, item_id)


def delete_item(
    session: Session,
    table_name: str,
    item_id: str,
) -> bool:
    """Delete a row by primary key. Returns True if successful."""
    table = get_table(table_name)
    if table is None:
        return False

    condition = _build_pk_conditions(table, item_id)
    if condition is None:
        return False

    session.execute(delete(table).where(condition))
    session.commit()
    return True


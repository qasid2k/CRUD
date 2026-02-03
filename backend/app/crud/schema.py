from typing import Any, Dict

from pydantic import RootModel


class ItemCreate(RootModel[Dict[str, Any]]):
    """
    Generic create payload for any table.

    Uses RootModel so the request body is just a plain JSON
    object with arbitrary fields, matching the dynamic CRUD style.
    """

    def to_dict(self) -> Dict[str, Any]:
        return self.root


class ItemUpdate(RootModel[Dict[str, Any]]):
    """Generic update payload for any table."""

    def to_dict(self) -> Dict[str, Any]:
        return self.root

from pydantic import BaseModel

class SpyRequest(BaseModel):
    supervisor_ext: str
    target_interface: str
    mode: str # 'spy', 'whisper', 'barge'


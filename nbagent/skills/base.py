"""Skill base class — all Skills inherit from this."""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from notebooklm import NotebookLMClient


@dataclass
class ActionInfo:
    """Metadata for a single skill action."""

    name: str
    description: str
    args: dict[str, str] = field(default_factory=dict)  # arg_name -> description


class BaseSkill(abc.ABC):
    """Abstract base class for all agent skills.

    Subclasses must set ``name``, ``description``, and ``_actions``,
    and implement ``execute``.
    """

    name: str = ""
    description: str = ""
    _actions: dict[str, ActionInfo] = {}

    def __init__(self, client: NotebookLMClient) -> None:
        self.client = client

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    def list_actions(self) -> list[ActionInfo]:
        """Return all available actions for this skill."""
        return list(self._actions.values())

    def get_action_info(self, action: str) -> ActionInfo | None:
        return self._actions.get(action)

    # ------------------------------------------------------------------
    # Core dispatch
    # ------------------------------------------------------------------

    @abc.abstractmethod
    async def execute(self, action: str, **kwargs: Any) -> Any:
        """Execute *action* with the given keyword arguments."""
        ...

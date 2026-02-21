"""Configuration management for nbagent."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml


_DEFAULT_DIR = Path.home() / ".nbagent"
_CONFIG_FILE = "config.yaml"


def _config_dir() -> Path:
    d = Path(os.environ.get("NBAGENT_HOME", str(_DEFAULT_DIR)))
    d.mkdir(parents=True, exist_ok=True)
    return d


def _config_path() -> Path:
    return _config_dir() / _CONFIG_FILE


class Config:
    """Simple YAML-backed configuration store.

    Keys
    ----
    active_notebook : str | None
        Currently selected notebook ID.
    custom_skills_dir : str | None
        Path to directory containing custom skill modules.
    """

    def __init__(self) -> None:
        self._data: dict[str, Any] = {}
        self._path = _config_path()
        self._load()

    # ------------------------------------------------------------------

    def _load(self) -> None:
        if self._path.exists():
            with open(self._path, "r", encoding="utf-8") as fh:
                self._data = yaml.safe_load(fh) or {}
        else:
            self._data = {}

    def save(self) -> None:
        with open(self._path, "w", encoding="utf-8") as fh:
            yaml.dump(self._data, fh, default_flow_style=False, allow_unicode=True)

    # ------------------------------------------------------------------
    # Accessors
    # ------------------------------------------------------------------

    @property
    def active_notebook(self) -> str | None:
        return self._data.get("active_notebook")

    @active_notebook.setter
    def active_notebook(self, value: str | None) -> None:
        self._data["active_notebook"] = value
        self.save()

    @property
    def custom_skills_dir(self) -> str | None:
        return self._data.get("custom_skills_dir")

    @custom_skills_dir.setter
    def custom_skills_dir(self, value: str | None) -> None:
        self._data["custom_skills_dir"] = value
        self.save()

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self._data[key] = value
        self.save()

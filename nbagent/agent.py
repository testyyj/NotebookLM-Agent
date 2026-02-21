"""NotebookLM Agent — core orchestrator with skill registration & dispatch."""

from __future__ import annotations

import importlib
import inspect
import sys
from pathlib import Path
from typing import Any

from notebooklm import NotebookLMClient

from .config import Config
from .skills.base import BaseSkill
from .skills import BUILTIN_SKILLS


class NotebookLMAgent:
    """Central agent managing the NotebookLM client and skill registry.

    Usage::

        async with NotebookLMAgent.create() as agent:
            result = await agent.execute("notebook", "list")
    """

    def __init__(self, client: NotebookLMClient, config: Config) -> None:
        self.client = client
        self.config = config
        self._skills: dict[str, BaseSkill] = {}

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    @classmethod
    async def create(
        cls,
        storage_path: str | None = None,
        skills_dir: str | None = None,
    ) -> "NotebookLMAgent":
        """Create an agent with an authenticated client.

        Parameters
        ----------
        storage_path : str | None
            Path to notebooklm-py storage_state.json.
        skills_dir : str | None
            Extra directory from which to load custom skills (in addition
            to the ``custom_skills_dir`` in config and the project-local
            ``custom_skills/`` folder).
        """
        if storage_path:
            client = await NotebookLMClient.from_storage(storage_path)
        else:
            client = await NotebookLMClient.from_storage()

        config = Config()
        agent = cls(client, config)

        # Register built-in skills
        for skill_cls in BUILTIN_SKILLS:
            agent.register_skill(skill_cls(client))

        # Load custom skills (config dir + project-local dir + CLI --skills-dir)
        agent._load_custom_skills(extra_dir=skills_dir)

        return agent

    # ------------------------------------------------------------------
    # Async context manager
    # ------------------------------------------------------------------

    async def __aenter__(self) -> "NotebookLMAgent":
        await self.client.__aenter__()
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.client.__aexit__(*exc)

    # ------------------------------------------------------------------
    # Skill management
    # ------------------------------------------------------------------

    def register_skill(self, skill: BaseSkill) -> None:
        """Register a skill instance."""
        self._skills[skill.name] = skill

    def list_skills(self) -> list[BaseSkill]:
        """Return all registered skills."""
        return list(self._skills.values())

    def get_skill(self, name: str) -> BaseSkill | None:
        return self._skills.get(name)

    # ------------------------------------------------------------------
    # Execution
    # ------------------------------------------------------------------

    async def execute(self, skill_name: str, action: str, **kwargs: Any) -> Any:
        """Execute an action on a skill.

        Automatically injects ``notebook_id`` from config when not supplied.
        """
        skill = self._skills.get(skill_name)
        if skill is None:
            raise ValueError(f"Unknown skill: {skill_name}")

        # Auto-inject active notebook_id when the action needs it
        if "notebook_id" not in kwargs or kwargs["notebook_id"] is None:
            if self.config.active_notebook:
                kwargs.setdefault("notebook_id", self.config.active_notebook)

        return await skill.execute(action, **kwargs)

    # ------------------------------------------------------------------
    # Custom skill loading
    # ------------------------------------------------------------------

    def _load_custom_skills(self, extra_dir: str | None = None) -> None:
        """Discover and load custom skills from configured directories.

        Directories checked (in order):
        1. ``custom_skills_dir`` from config
        2. Project-local ``custom_skills/`` folder
        3. ``extra_dir`` (e.g. from CLI ``--skills-dir``)
        """
        dirs_to_check: list[Path] = []

        # 1. Config
        if self.config.custom_skills_dir:
            dirs_to_check.append(Path(self.config.custom_skills_dir))

        # 2. Project-local
        project_dir = Path(__file__).resolve().parent.parent / "custom_skills"
        if project_dir.is_dir():
            dirs_to_check.append(project_dir)

        # 3. CLI --skills-dir
        if extra_dir:
            dirs_to_check.append(Path(extra_dir))

        seen: set[str] = set()
        for skills_path in dirs_to_check:
            if not skills_path.is_dir():
                continue

            sys_path_str = str(skills_path)
            if sys_path_str not in sys.path:
                sys.path.insert(0, sys_path_str)

            for py_file in skills_path.glob("*.py"):
                if py_file.name.startswith("_"):
                    continue
                if py_file.name in seen:
                    continue
                seen.add(py_file.name)
                module_name = f"custom_skill_{py_file.stem}"
                try:
                    spec = importlib.util.spec_from_file_location(module_name, py_file)
                    if spec and spec.loader:
                        module = importlib.util.module_from_spec(spec)
                        spec.loader.exec_module(module)
                        for _, obj in inspect.getmembers(module, inspect.isclass):
                            if issubclass(obj, BaseSkill) and obj is not BaseSkill:
                                skill_instance = obj(self.client)
                                self.register_skill(skill_instance)
                except Exception as exc:
                    import warnings
                    warnings.warn(f"Failed to load custom skill {py_file.name}: {exc}")

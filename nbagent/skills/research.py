"""Web / Drive research skill — start research, poll, import sources."""

from __future__ import annotations

import asyncio
from typing import Any

from .base import ActionInfo, BaseSkill


class ResearchSkill(BaseSkill):
    name = "research"
    description = "自动研究（Web / Google Drive 搜索，发现新数据源并导入）"

    _actions = {
        "start": ActionInfo(
            "start",
            "启动研究任务",
            {
                "notebook_id": "笔记本 ID",
                "query": "搜索关键词",
                "source": "搜索源 (web / drive，默认 web)",
                "mode": "搜索模式 (fast / deep，默认 fast)",
            },
        ),
        "poll": ActionInfo(
            "poll",
            "查询研究任务状态",
            {"notebook_id": "笔记本 ID"},
        ),
        "import": ActionInfo(
            "import",
            "导入研究发现的数据源",
            {
                "notebook_id": "笔记本 ID",
                "task_id": "研究任务 ID",
                "max_sources": "最多导入数量（默认 5）",
            },
        ),
        "run": ActionInfo(
            "run",
            "启动研究并等待完成后自动导入（一站式）",
            {
                "notebook_id": "笔记本 ID",
                "query": "搜索关键词",
                "source": "搜索源 (web / drive，默认 web)",
                "mode": "搜索模式 (fast / deep，默认 fast)",
                "max_sources": "最多导入数量（默认 5）",
            },
        ),
    }

    async def execute(self, action: str, **kwargs: Any) -> Any:
        nb_id = kwargs.get("notebook_id", "")
        match action:
            case "start":
                return await self._start(
                    nb_id,
                    kwargs["query"],
                    kwargs.get("source", "web"),
                    kwargs.get("mode", "fast"),
                )
            case "poll":
                return await self._poll(nb_id)
            case "import":
                return await self._import(
                    nb_id,
                    kwargs["task_id"],
                    int(kwargs.get("max_sources", 5)),
                )
            case "run":
                return await self._run(
                    nb_id,
                    kwargs["query"],
                    kwargs.get("source", "web"),
                    kwargs.get("mode", "fast"),
                    int(kwargs.get("max_sources", 5)),
                )
            case _:
                raise ValueError(f"Unknown action: {action}")

    # ------------------------------------------------------------------

    async def _start(
        self, notebook_id: str, query: str, source: str, mode: str
    ) -> dict:
        result = await self.client.research.start(
            notebook_id, query, source=source, mode=mode
        )
        return result

    async def _poll(self, notebook_id: str) -> dict:
        return await self.client.research.poll(notebook_id)

    async def _import(
        self, notebook_id: str, task_id: str, max_sources: int
    ) -> dict:
        status = await self.client.research.poll(notebook_id)
        sources = status.get("sources", [])[:max_sources]
        if not sources:
            return {"imported": 0, "message": "No sources to import"}
        imported = await self.client.research.import_sources(
            notebook_id, task_id, sources
        )
        return {"imported": len(imported), "sources": imported}

    async def _run(
        self,
        notebook_id: str,
        query: str,
        source: str,
        mode: str,
        max_sources: int,
    ) -> dict:
        """One-shot: start → poll until done → import top sources."""
        result = await self.client.research.start(
            notebook_id, query, source=source, mode=mode
        )
        task_id = result["task_id"]

        # Poll until complete
        for _ in range(60):
            status = await self.client.research.poll(notebook_id)
            if status.get("status") == "completed":
                break
            await asyncio.sleep(10)
        else:
            return {"status": "timeout", "task_id": task_id}

        # Import
        sources = status.get("sources", [])[:max_sources]
        if not sources:
            return {
                "status": "completed",
                "imported": 0,
                "summary": status.get("summary", ""),
            }

        imported = await self.client.research.import_sources(
            notebook_id, task_id, sources
        )
        return {
            "status": "completed",
            "imported": len(imported),
            "summary": status.get("summary", ""),
            "sources": imported,
        }

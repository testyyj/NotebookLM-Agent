"""Notebook management skill — create, list, delete, rename notebooks."""

from __future__ import annotations

from typing import Any

from .base import ActionInfo, BaseSkill


class NotebookSkill(BaseSkill):
    name = "notebook"
    description = "管理 NotebookLM 笔记本（创建/列表/删除/重命名/查看详情）"

    _actions = {
        "list": ActionInfo("list", "列出所有笔记本"),
        "create": ActionInfo("create", "创建新笔记本", {"title": "笔记本标题"}),
        "delete": ActionInfo("delete", "删除笔记本", {"notebook_id": "笔记本 ID"}),
        "rename": ActionInfo(
            "rename",
            "重命名笔记本",
            {"notebook_id": "笔记本 ID", "new_title": "新标题"},
        ),
        "info": ActionInfo("info", "查看笔记本详情", {"notebook_id": "笔记本 ID"}),
        "use": ActionInfo("use", "设置当前活动笔记本", {"notebook_id": "笔记本 ID"}),
        "summary": ActionInfo("summary", "获取 AI 生成的笔记本摘要", {"notebook_id": "笔记本 ID"}),
    }

    async def execute(self, action: str, **kwargs: Any) -> Any:
        match action:
            case "list":
                return await self._list()
            case "create":
                return await self._create(kwargs["title"])
            case "delete":
                return await self._delete(kwargs["notebook_id"])
            case "rename":
                return await self._rename(kwargs["notebook_id"], kwargs["new_title"])
            case "info":
                return await self._info(kwargs["notebook_id"])
            case "use":
                return await self._use(kwargs["notebook_id"])
            case "summary":
                return await self._summary(kwargs["notebook_id"])
            case _:
                raise ValueError(f"Unknown action: {action}")

    # ------------------------------------------------------------------

    async def _list(self) -> list[dict]:
        notebooks = await self.client.notebooks.list()
        return [
            {
                "id": nb.id,
                "title": nb.title,
                "sources_count": getattr(nb, "sources_count", 0),
            }
            for nb in notebooks
        ]

    async def _create(self, title: str) -> dict:
        nb = await self.client.notebooks.create(title)
        return {"id": nb.id, "title": nb.title}

    async def _delete(self, notebook_id: str) -> dict:
        ok = await self.client.notebooks.delete(notebook_id)
        return {"deleted": ok, "notebook_id": notebook_id}

    async def _rename(self, notebook_id: str, new_title: str) -> dict:
        nb = await self.client.notebooks.rename(notebook_id, new_title)
        return {"id": nb.id, "title": nb.title}

    async def _info(self, notebook_id: str) -> dict:
        nb = await self.client.notebooks.get(notebook_id)
        return {
            "id": nb.id,
            "title": nb.title,
            "sources_count": getattr(nb, "sources_count", 0),
        }

    async def _use(self, notebook_id: str) -> dict:
        # Verify notebook exists first
        nb = await self.client.notebooks.get(notebook_id)
        # We return the id; the CLI will persist it to config
        return {"id": nb.id, "title": nb.title, "active": True}

    async def _summary(self, notebook_id: str) -> dict:
        desc = await self.client.notebooks.get_description(notebook_id)
        topics = []
        if hasattr(desc, "suggested_topics"):
            topics = [
                getattr(t, "question", str(t)) for t in desc.suggested_topics
            ]
        return {"summary": desc.summary, "suggested_topics": topics}

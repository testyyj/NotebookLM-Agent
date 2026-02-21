"""Source management skill — add, list, delete, refresh data sources."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .base import ActionInfo, BaseSkill


class SourceSkill(BaseSkill):
    name = "source"
    description = "管理笔记本数据源（添加 URL / 文件 / YouTube / 文本 / 列出 / 删除）"

    _actions = {
        "list": ActionInfo(
            "list", "列出笔记本的所有数据源", {"notebook_id": "笔记本 ID"}
        ),
        "add-url": ActionInfo(
            "add-url",
            "添加 URL 作为数据源",
            {"notebook_id": "笔记本 ID", "url": "网页地址"},
        ),
        "add-file": ActionInfo(
            "add-file",
            "上传本地文件作为数据源",
            {"notebook_id": "笔记本 ID", "path": "文件路径"},
        ),
        "add-youtube": ActionInfo(
            "add-youtube",
            "添加 YouTube 视频作为数据源",
            {"notebook_id": "笔记本 ID", "url": "YouTube 链接"},
        ),
        "add-text": ActionInfo(
            "add-text",
            "添加自定义文本作为数据源",
            {"notebook_id": "笔记本 ID", "title": "标题", "content": "文本内容"},
        ),
        "delete": ActionInfo(
            "delete",
            "删除数据源",
            {"notebook_id": "笔记本 ID", "source_id": "数据源 ID"},
        ),
        "refresh": ActionInfo(
            "refresh",
            "刷新数据源（重新抓取内容）",
            {"notebook_id": "笔记本 ID", "source_id": "数据源 ID"},
        ),
        "fulltext": ActionInfo(
            "fulltext",
            "获取数据源的完整索引文本",
            {"notebook_id": "笔记本 ID", "source_id": "数据源 ID"},
        ),
        "guide": ActionInfo(
            "guide",
            "获取数据源的 AI 摘要和关键词",
            {"notebook_id": "笔记本 ID", "source_id": "数据源 ID"},
        ),
    }

    async def execute(self, action: str, **kwargs: Any) -> Any:
        nb_id = kwargs.get("notebook_id", "")
        match action:
            case "list":
                return await self._list(nb_id)
            case "add-url":
                return await self._add_url(nb_id, kwargs["url"])
            case "add-file":
                return await self._add_file(nb_id, kwargs["path"])
            case "add-youtube":
                return await self._add_youtube(nb_id, kwargs["url"])
            case "add-text":
                return await self._add_text(nb_id, kwargs["title"], kwargs["content"])
            case "delete":
                return await self._delete(nb_id, kwargs["source_id"])
            case "refresh":
                return await self._refresh(nb_id, kwargs["source_id"])
            case "fulltext":
                return await self._fulltext(nb_id, kwargs["source_id"])
            case "guide":
                return await self._guide(nb_id, kwargs["source_id"])
            case _:
                raise ValueError(f"Unknown action: {action}")

    # ------------------------------------------------------------------

    async def _list(self, notebook_id: str) -> list[dict]:
        sources = await self.client.sources.list(notebook_id)
        return [
            {
                "id": src.id,
                "title": src.title,
                "kind": getattr(src, "kind", "unknown"),
            }
            for src in sources
        ]

    async def _add_url(self, notebook_id: str, url: str) -> dict:
        src = await self.client.sources.add_url(notebook_id, url)
        return {"id": src.id, "title": src.title}

    async def _add_file(self, notebook_id: str, path: str) -> dict:
        src = await self.client.sources.add_file(notebook_id, Path(path))
        return {"id": src.id, "title": src.title}

    async def _add_youtube(self, notebook_id: str, url: str) -> dict:
        src = await self.client.sources.add_youtube(notebook_id, url)
        return {"id": src.id, "title": src.title}

    async def _add_text(self, notebook_id: str, title: str, content: str) -> dict:
        src = await self.client.sources.add_text(notebook_id, title, content)
        return {"id": src.id, "title": src.title}

    async def _delete(self, notebook_id: str, source_id: str) -> dict:
        ok = await self.client.sources.delete(notebook_id, source_id)
        return {"deleted": ok, "source_id": source_id}

    async def _refresh(self, notebook_id: str, source_id: str) -> dict:
        ok = await self.client.sources.refresh(notebook_id, source_id)
        return {"refreshed": ok, "source_id": source_id}

    async def _fulltext(self, notebook_id: str, source_id: str) -> dict:
        ft = await self.client.sources.get_fulltext(notebook_id, source_id)
        return {
            "source_id": source_id,
            "char_count": ft.char_count,
            "content": ft.content[:2000] + ("..." if ft.char_count > 2000 else ""),
        }

    async def _guide(self, notebook_id: str, source_id: str) -> dict:
        guide = await self.client.sources.get_guide(notebook_id, source_id)
        return guide

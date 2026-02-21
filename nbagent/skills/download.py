"""Artifact download skill — download generated content locally."""

from __future__ import annotations

from typing import Any

from .base import ActionInfo, BaseSkill


class DownloadSkill(BaseSkill):
    name = "download"
    description = "下载生成的制品到本地（MP3 / MP4 / PDF / JSON / CSV / Markdown）"

    _actions = {
        "audio": ActionInfo(
            "audio",
            "下载音频播客 (MP3)",
            {"notebook_id": "笔记本 ID", "output": "输出文件路径"},
        ),
        "video": ActionInfo(
            "video",
            "下载视频 (MP4)",
            {"notebook_id": "笔记本 ID", "output": "输出文件路径"},
        ),
        "quiz": ActionInfo(
            "quiz",
            "下载测验题",
            {
                "notebook_id": "笔记本 ID",
                "output": "输出文件路径",
                "format": "格式 (json / markdown / html，默认 json)",
            },
        ),
        "flashcards": ActionInfo(
            "flashcards",
            "下载闪卡",
            {
                "notebook_id": "笔记本 ID",
                "output": "输出文件路径",
                "format": "格式 (json / markdown，默认 json)",
            },
        ),
        "slide-deck": ActionInfo(
            "slide-deck",
            "下载幻灯片 (PDF)",
            {"notebook_id": "笔记本 ID", "output": "输出文件路径"},
        ),
        "mind-map": ActionInfo(
            "mind-map",
            "下载思维导图 (JSON)",
            {"notebook_id": "笔记本 ID", "output": "输出文件路径"},
        ),
        "data-table": ActionInfo(
            "data-table",
            "下载数据表 (CSV)",
            {"notebook_id": "笔记本 ID", "output": "输出文件路径"},
        ),
    }

    async def execute(self, action: str, **kwargs: Any) -> Any:
        nb_id = kwargs.get("notebook_id", "")
        output = kwargs.get("output", "")
        fmt = kwargs.get("format")

        match action:
            case "audio":
                return await self._download(nb_id, "audio", output)
            case "video":
                return await self._download(nb_id, "video", output)
            case "quiz":
                return await self._download(nb_id, "quiz", output, fmt or "json")
            case "flashcards":
                return await self._download(nb_id, "flashcards", output, fmt or "json")
            case "slide-deck":
                return await self._download(nb_id, "slide_deck", output)
            case "mind-map":
                return await self._download(nb_id, "mind_map", output)
            case "data-table":
                return await self._download(nb_id, "data_table", output)
            case _:
                raise ValueError(f"Unknown action: {action}")

    # ------------------------------------------------------------------

    async def _download(
        self,
        notebook_id: str,
        artifact_type: str,
        output: str,
        output_format: str | None = None,
    ) -> dict:
        method_map = {
            "audio": self.client.artifacts.download_audio,
            "video": self.client.artifacts.download_video,
            "quiz": self.client.artifacts.download_quiz,
            "flashcards": self.client.artifacts.download_flashcards,
            "slide_deck": self.client.artifacts.download_slide_deck,
            "mind_map": self.client.artifacts.download_mind_map,
            "data_table": self.client.artifacts.download_data_table,
        }

        method = method_map.get(artifact_type)
        if not method:
            raise ValueError(f"Unknown artifact type: {artifact_type}")

        dl_kwargs: dict[str, Any] = {}
        if output_format:
            dl_kwargs["output_format"] = output_format

        await method(notebook_id, output, **dl_kwargs)
        return {"downloaded": True, "type": artifact_type, "path": output}

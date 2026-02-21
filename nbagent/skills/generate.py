"""Content generation skill — audio, video, quiz, flashcards, reports, etc."""

from __future__ import annotations

from typing import Any

from .base import ActionInfo, BaseSkill


class GenerateSkill(BaseSkill):
    name = "generate"
    description = "生成内容制品（播客 / 视频 / Quiz / 闪卡 / 报告 / 幻灯片 / 思维导图 / 数据表）"

    _actions = {
        "audio": ActionInfo(
            "audio",
            "生成音频播客（Audio Overview）",
            {"notebook_id": "笔记本 ID", "instructions": "自定义指令（可选）"},
        ),
        "video": ActionInfo(
            "video",
            "生成视频概述",
            {"notebook_id": "笔记本 ID", "instructions": "自定义指令（可选）"},
        ),
        "quiz": ActionInfo(
            "quiz",
            "生成测验题",
            {"notebook_id": "笔记本 ID", "instructions": "自定义指令（可选）"},
        ),
        "flashcards": ActionInfo(
            "flashcards",
            "生成闪卡（Flashcards）",
            {"notebook_id": "笔记本 ID"},
        ),
        "report": ActionInfo(
            "report",
            "生成报告/学习指南",
            {
                "notebook_id": "笔记本 ID",
                "title": "报告标题（可选）",
                "description": "报告描述（可选）",
            },
        ),
        "slide-deck": ActionInfo(
            "slide-deck",
            "生成幻灯片",
            {"notebook_id": "笔记本 ID"},
        ),
        "infographic": ActionInfo(
            "infographic",
            "生成信息图",
            {"notebook_id": "笔记本 ID"},
        ),
        "mind-map": ActionInfo(
            "mind-map",
            "生成思维导图",
            {"notebook_id": "笔记本 ID"},
        ),
        "data-table": ActionInfo(
            "data-table",
            "生成数据表",
            {"notebook_id": "笔记本 ID", "instructions": "自定义指令（可选）"},
        ),
    }

    async def execute(self, action: str, **kwargs: Any) -> Any:
        nb_id = kwargs.get("notebook_id", "")
        instructions = kwargs.get("instructions")
        wait = kwargs.get("wait", True)

        match action:
            case "audio":
                return await self._generate(
                    nb_id, "audio", instructions=instructions, wait=wait
                )
            case "video":
                return await self._generate(
                    nb_id, "video", instructions=instructions, wait=wait
                )
            case "quiz":
                return await self._generate(
                    nb_id, "quiz", instructions=instructions, wait=wait
                )
            case "flashcards":
                return await self._generate(nb_id, "flashcards", wait=wait)
            case "report":
                return await self._generate(
                    nb_id,
                    "report",
                    title=kwargs.get("title"),
                    description=kwargs.get("description"),
                    wait=wait,
                )
            case "slide-deck":
                return await self._generate(nb_id, "slide_deck", wait=wait)
            case "infographic":
                return await self._generate(nb_id, "infographic", wait=wait)
            case "mind-map":
                return await self._generate(nb_id, "mind_map", wait=wait)
            case "data-table":
                return await self._generate(
                    nb_id, "data_table", instructions=instructions, wait=wait
                )
            case _:
                raise ValueError(f"Unknown action: {action}")

    # ------------------------------------------------------------------

    async def _generate(
        self,
        notebook_id: str,
        artifact_type: str,
        wait: bool = True,
        **gen_kwargs: Any,
    ) -> dict:
        """Generate any artifact type and optionally wait for completion."""
        # Map to the correct client method
        method_map = {
            "audio": self.client.artifacts.generate_audio,
            "video": self.client.artifacts.generate_video,
            "quiz": self.client.artifacts.generate_quiz,
            "flashcards": self.client.artifacts.generate_flashcards,
            "report": self.client.artifacts.generate_report,
            "slide_deck": self.client.artifacts.generate_slide_deck,
            "infographic": self.client.artifacts.generate_infographic,
            "mind_map": self.client.artifacts.generate_mind_map,
            "data_table": self.client.artifacts.generate_data_table,
        }

        method = method_map.get(artifact_type)
        if not method:
            raise ValueError(f"Unknown artifact type: {artifact_type}")

        # Filter out None values from kwargs
        clean_kwargs = {k: v for k, v in gen_kwargs.items() if v is not None}
        status = await method(notebook_id, **clean_kwargs)

        result: dict[str, Any] = {
            "type": artifact_type,
            "task_id": getattr(status, "task_id", None),
            "status": "started",
        }

        if wait and hasattr(status, "task_id") and status.task_id:
            final = await self.client.artifacts.wait_for_completion(
                notebook_id, status.task_id, timeout=600
            )
            result["status"] = "complete" if final.is_complete else "failed"
            result["url"] = getattr(final, "url", None)

        return result

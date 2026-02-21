"""Chat / RAG skill — ask questions, configure persona, view history."""

from __future__ import annotations

from typing import Any

from .base import ActionInfo, BaseSkill


class ChatSkill(BaseSkill):
    name = "chat"
    description = "与笔记本数据源对话（RAG 问答 / 配置 Persona / 查看历史）"

    _actions = {
        "ask": ActionInfo(
            "ask",
            "基于笔记本数据源回答问题",
            {"notebook_id": "笔记本 ID", "question": "问题"},
        ),
        "history": ActionInfo(
            "history", "查看对话历史", {"notebook_id": "笔记本 ID"}
        ),
        "configure": ActionInfo(
            "configure",
            "配置对话 Persona / 回复风格",
            {
                "notebook_id": "笔记本 ID",
                "custom_prompt": "自定义系统提示词（可选）",
            },
        ),
    }

    async def execute(self, action: str, **kwargs: Any) -> Any:
        nb_id = kwargs.get("notebook_id", "")
        match action:
            case "ask":
                return await self._ask(nb_id, kwargs["question"], kwargs.get("source_ids"))
            case "history":
                return await self._history(nb_id)
            case "configure":
                return await self._configure(nb_id, kwargs.get("custom_prompt"))
            case _:
                raise ValueError(f"Unknown action: {action}")

    # ------------------------------------------------------------------

    async def _ask(
        self,
        notebook_id: str,
        question: str,
        source_ids: list[str] | None = None,
    ) -> dict:
        result = await self.client.chat.ask(
            notebook_id, question, source_ids=source_ids
        )
        refs = []
        if hasattr(result, "references") and result.references:
            refs = [
                {
                    "citation": getattr(r, "citation_number", None),
                    "source_id": getattr(r, "source_id", None),
                }
                for r in result.references
            ]
        return {
            "answer": result.answer,
            "conversation_id": getattr(result, "conversation_id", None),
            "references": refs,
        }

    async def _history(self, notebook_id: str) -> list[dict]:
        history = await self.client.chat.get_history(notebook_id)
        return [
            {
                "role": getattr(turn, "role", "unknown"),
                "content": getattr(turn, "content", str(turn)),
            }
            for turn in history
        ]

    async def _configure(self, notebook_id: str, custom_prompt: str | None = None) -> dict:
        kwargs: dict[str, Any] = {}
        if custom_prompt:
            kwargs["custom_prompt"] = custom_prompt
        ok = await self.client.chat.configure(notebook_id, **kwargs)
        return {"configured": ok}

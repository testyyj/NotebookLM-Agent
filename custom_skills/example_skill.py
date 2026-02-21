"""Example custom skill — demonstrates how to extend the agent.

Drop this file (or your own) into the ``custom_skills/`` directory
and it will be auto-discovered on agent startup.
"""

from __future__ import annotations

from typing import Any

from nbagent.skills.base import ActionInfo, BaseSkill


class ExampleSkill(BaseSkill):
    """A minimal example skill to demonstrate the extension mechanism."""

    name = "example"
    description = "示例自定义 Skill（展示如何扩展 Agent）"

    _actions = {
        "hello": ActionInfo("hello", "打招呼", {"name": "你的名字"}),
        "status": ActionInfo("status", "显示 Agent 状态"),
    }

    async def execute(self, action: str, **kwargs: Any) -> Any:
        match action:
            case "hello":
                name = kwargs.get("name", "World")
                return {"message": f"你好, {name}! 👋 这是一个自定义 Skill 示例。"}
            case "status":
                # Access the underlying client to show something useful
                notebooks = await self.client.notebooks.list()
                return {
                    "notebook_count": len(notebooks),
                    "message": "Agent 运行正常 ✅",
                }
            case _:
                raise ValueError(f"Unknown action: {action}")

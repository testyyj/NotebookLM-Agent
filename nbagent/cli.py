"""CLI interface for NotebookLM Agent — powered by Click + Rich."""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from typing import Any

import click
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.syntax import Syntax
from rich import box

from .agent import NotebookLMAgent
from .config import Config

console = Console()


def _get_skills_dir(ctx: click.Context) -> str | None:
    """Extract skills_dir from the Click context."""
    return ctx.obj.get("skills_dir") if ctx.obj else None


def _run(coro):
    """Run an async coroutine in the event loop."""
    return asyncio.run(coro)


def _pretty_result(result: Any) -> None:
    """Pretty-print a skill result using Rich."""
    if isinstance(result, dict):
        console.print_json(json.dumps(result, ensure_ascii=False, indent=2))
    elif isinstance(result, list):
        if result and isinstance(result[0], dict):
            # Render as table
            table = Table(box=box.ROUNDED, show_lines=True)
            keys = list(result[0].keys())
            for k in keys:
                table.add_column(k, style="cyan")
            for row in result:
                table.add_row(*[str(row.get(k, "")) for k in keys])
            console.print(table)
        else:
            console.print_json(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        console.print(result)


# ======================================================================
# CLI Group
# ======================================================================


@click.group()
@click.version_option(package_name="nbagent")
@click.option(
    "--skills-dir",
    default=None,
    type=click.Path(exists=True, file_okay=False),
    help="从指定目录加载自定义 Skill",
)
@click.pass_context
def main(ctx, skills_dir):
    """🤖 NotebookLM Agent — 可扩展 Skill 的命令行 Agent

    无需打开网页，直接在终端操作 NotebookLM 的全部功能。
    """
    ctx.ensure_object(dict)
    ctx.obj["skills_dir"] = skills_dir


# ======================================================================
# login
# ======================================================================


@main.command()
def login():
    """🔐 登录 Google 账号（使用 notebooklm login）"""
    console.print(
        Panel(
            "[bold yellow]首次登录将打开浏览器进行 Google 认证。\n"
            "登录成功后，后续所有操作都不需要浏览器。[/]",
            title="🔐 NotebookLM 登录",
        )
    )
    import shutil

    notebooklm_bin = shutil.which("notebooklm")
    if not notebooklm_bin:
        console.print(
            "[bold red]❌ 未找到 notebooklm 命令。请先安装: pip install 'notebooklm-py[browser]'[/]"
        )
        sys.exit(1)
    try:
        subprocess.run([notebooklm_bin, "login"], check=True)
        console.print("[bold green]✅ 登录成功！[/]")
    except subprocess.CalledProcessError:
        console.print("[bold red]❌ 登录失败，请重试。[/]")
        sys.exit(1)


# ======================================================================
# skills — list registered skills
# ======================================================================


@main.command("skills")
@click.pass_context
def list_skills(ctx):
    """📦 列出所有已注册的 Skill"""
    skills_dir = _get_skills_dir(ctx)

    async def _inner():
        try:
            async with await NotebookLMAgent.create(skills_dir=skills_dir) as agent:
                skills = agent.list_skills()
                table = Table(
                    title="📦 已注册 Skills",
                    box=box.ROUNDED,
                    show_lines=True,
                    title_style="bold magenta",
                )
                table.add_column("名称", style="bold cyan", min_width=12)
                table.add_column("描述", style="white")
                table.add_column("动作", style="green")
                for skill in skills:
                    actions = ", ".join(a.name for a in skill.list_actions())
                    table.add_row(skill.name, skill.description, actions)
                console.print(table)
        except Exception as exc:
            console.print(f"[bold red]❌ {exc}[/]")
            console.print(
                "[dim]提示：如果尚未登录，请先运行 [bold]nbagent login[/bold][/]"
            )

    _run(_inner())


# ======================================================================
# run — execute a skill action
# ======================================================================


@main.command("run")
@click.argument("skill")
@click.argument("action")
@click.argument("args", nargs=-1)
@click.option("-n", "--notebook", "notebook_id", default=None, help="笔记本 ID")
@click.pass_context
def run(ctx, skill: str, action: str, args: tuple, notebook_id: str | None):
    """🚀 执行 Skill 动作

    \b
    用法示例：
      nbagent run notebook list
      nbagent run notebook create "My Research"
      nbagent run source add-url "https://example.com" -n <notebook_id>
      nbagent run chat ask "What is this about?" -n <notebook_id>
      nbagent run generate audio -n <notebook_id>
      nbagent run download audio ./podcast.mp3 -n <notebook_id>
    """

    skills_dir = _get_skills_dir(ctx)

    async def _inner():
        try:
            async with await NotebookLMAgent.create(skills_dir=skills_dir) as agent:
                # Build kwargs from positional args and action metadata
                kwargs: dict[str, Any] = {}
                if notebook_id:
                    kwargs["notebook_id"] = notebook_id

                # Map positional args to parameter names based on action info
                sk = agent.get_skill(skill)
                if not sk:
                    console.print(f"[bold red]❌ 未知 Skill: {skill}[/]")
                    console.print(
                        "可用 Skills: "
                        + ", ".join(s.name for s in agent.list_skills())
                    )
                    return

                action_info = sk.get_action_info(action)
                if not action_info:
                    console.print(
                        f"[bold red]❌ Skill '{skill}' 没有动作 '{action}'[/]"
                    )
                    console.print(
                        "可用动作: "
                        + ", ".join(a.name for a in sk.list_actions())
                    )
                    return

                # Map positional args to named params (skip notebook_id — already set)
                param_names = [
                    p
                    for p in action_info.args.keys()
                    if p != "notebook_id"
                ]
                for i, val in enumerate(args):
                    if i < len(param_names):
                        kwargs[param_names[i]] = val

                # Special handling: "notebook use" should persist to config
                result = await agent.execute(skill, action, **kwargs)

                if skill == "notebook" and action == "use" and isinstance(result, dict):
                    agent.config.active_notebook = result.get("id")
                    console.print(
                        f"[bold green]✅ 当前活动笔记本已设为: {result.get('title')} ({result.get('id')})[/]"
                    )
                    return

                _pretty_result(result)
        except Exception as exc:
            console.print(f"[bold red]❌ Error: {exc}[/]")

    _run(_inner())


# ======================================================================
# use — shortcut to set active notebook
# ======================================================================


@main.command("use")
@click.argument("notebook_id")
@click.pass_context
def use_notebook(ctx, notebook_id: str):
    """📌 设置当前活动笔记本（快捷方式）"""
    skills_dir = _get_skills_dir(ctx)

    async def _inner():
        try:
            async with await NotebookLMAgent.create(skills_dir=skills_dir) as agent:
                result = await agent.execute("notebook", "use", notebook_id=notebook_id)
                agent.config.active_notebook = result.get("id")
                console.print(
                    f"[bold green]✅ 当前活动笔记本: {result.get('title')} ({result.get('id')})[/]"
                )
        except Exception as exc:
            console.print(f"[bold red]❌ {exc}[/]")

    _run(_inner())


# ======================================================================
# ask — shortcut to chat
# ======================================================================


@main.command("ask")
@click.argument("question")
@click.option("-n", "--notebook", "notebook_id", default=None, help="笔记本 ID")
@click.pass_context
def ask(ctx, question: str, notebook_id: str | None):
    """💬 快捷提问（使用当前活动笔记本）"""
    skills_dir = _get_skills_dir(ctx)

    async def _inner():
        try:
            async with await NotebookLMAgent.create(skills_dir=skills_dir) as agent:
                kwargs: dict[str, Any] = {"question": question}
                if notebook_id:
                    kwargs["notebook_id"] = notebook_id
                result = await agent.execute("chat", "ask", **kwargs)
                if isinstance(result, dict):
                    console.print(
                        Panel(
                            result.get("answer", ""),
                            title="💬 回答",
                            border_style="green",
                        )
                    )
                    refs = result.get("references", [])
                    if refs:
                        console.print("[dim]引用来源:[/]")
                        for r in refs:
                            console.print(
                                f"  [{r.get('citation')}] source={r.get('source_id')}"
                            )
                else:
                    console.print(result)
        except Exception as exc:
            console.print(f"[bold red]❌ {exc}[/]")

    _run(_inner())


# ======================================================================
# interactive — REPL mode
# ======================================================================


@main.command("interactive")
@click.option("-n", "--notebook", "notebook_id", default=None, help="笔记本 ID")
@click.pass_context
def interactive(ctx, notebook_id: str | None):
    """🖥️  交互式 REPL 模式"""
    skills_dir = _get_skills_dir(ctx)

    async def _repl():
        try:
            async with await NotebookLMAgent.create(skills_dir=skills_dir) as agent:
                if notebook_id:
                    agent.config.active_notebook = notebook_id

                console.print(
                    Panel(
                        "[bold]NotebookLM Agent 交互模式[/]\n\n"
                        "输入格式: [cyan]<skill> <action> [args...][/]\n"
                        "快捷命令:\n"
                        "  [green]ask <question>[/]  — 提问\n"
                        "  [green]skills[/]          — 列出所有 Skill\n"
                        "  [green]help <skill>[/]    — 查看 Skill 详情\n"
                        "  [green]quit / exit[/]     — 退出\n",
                        title="🤖 NotebookLM Agent",
                        border_style="magenta",
                    )
                )

                active = agent.config.active_notebook
                if active:
                    console.print(f"[dim]当前活动笔记本: {active}[/]\n")

                while True:
                    try:
                        user_input = console.input("[bold cyan]nbagent>[/] ").strip()
                    except (EOFError, KeyboardInterrupt):
                        console.print("\n[dim]Bye![/]")
                        break

                    if not user_input:
                        continue
                    if user_input in ("quit", "exit", "q"):
                        console.print("[dim]Bye![/]")
                        break

                    parts = user_input.split()

                    # Quick commands
                    if parts[0] == "skills":
                        for sk in agent.list_skills():
                            actions = ", ".join(a.name for a in sk.list_actions())
                            console.print(
                                f"  [cyan]{sk.name}[/] — {sk.description}  [{actions}]"
                            )
                        continue

                    if parts[0] == "help" and len(parts) >= 2:
                        sk = agent.get_skill(parts[1])
                        if sk:
                            for ai in sk.list_actions():
                                args_str = (
                                    " ".join(f"<{k}>" for k in ai.args if k != "notebook_id")
                                    if ai.args
                                    else ""
                                )
                                console.print(
                                    f"  [green]{ai.name}[/] {args_str} — {ai.description}"
                                )
                        else:
                            console.print(f"[red]未知 Skill: {parts[1]}[/]")
                        continue

                    if parts[0] == "ask":
                        question = " ".join(parts[1:])
                        if question:
                            try:
                                result = await agent.execute(
                                    "chat", "ask", question=question
                                )
                                console.print(
                                    Panel(
                                        result.get("answer", ""),
                                        title="💬",
                                        border_style="green",
                                    )
                                )
                            except Exception as e:
                                console.print(f"[red]{e}[/]")
                        continue

                    # General: <skill> <action> [args...]
                    if len(parts) < 2:
                        console.print("[dim]格式: <skill> <action> [args...][/]")
                        continue

                    skill_name, action_name = parts[0], parts[1]
                    pos_args = parts[2:]

                    sk = agent.get_skill(skill_name)
                    if not sk:
                        console.print(f"[red]未知 Skill: {skill_name}[/]")
                        continue

                    action_info = sk.get_action_info(action_name)
                    if not action_info:
                        console.print(f"[red]未知动作: {action_name}[/]")
                        continue

                    kwargs: dict[str, Any] = {}
                    param_names = [
                        p for p in action_info.args.keys() if p != "notebook_id"
                    ]
                    for i, val in enumerate(pos_args):
                        if i < len(param_names):
                            kwargs[param_names[i]] = val

                    try:
                        result = await agent.execute(skill_name, action_name, **kwargs)
                        if skill_name == "notebook" and action_name == "use" and isinstance(result, dict):
                            agent.config.active_notebook = result.get("id")
                            console.print(
                                f"[green]✅ 活动笔记本: {result.get('title')}[/]"
                            )
                        else:
                            _pretty_result(result)
                    except Exception as e:
                        console.print(f"[red]❌ {e}[/]")

        except Exception as exc:
            console.print(f"[bold red]❌ {exc}[/]")
            console.print("[dim]请先运行 nbagent login[/]")

    _run(_repl())


# ======================================================================
# config — manage configuration
# ======================================================================


@main.command("config")
@click.argument("action", type=click.Choice(["show", "set"]))
@click.argument("args", nargs=-1)
def config_cmd(action: str, args: tuple):
    """⚙️  查看/修改配置

    \b
      nbagent config show
      nbagent config set custom_skills_dir /path/to/skills
    """
    cfg = Config()
    if action == "show":
        console.print(
            Panel(
                f"active_notebook: {cfg.active_notebook or '(未设置)'}\n"
                f"custom_skills_dir: {cfg.custom_skills_dir or '(未设置)'}\n"
                f"config path: {cfg._path}",
                title="⚙️ 配置",
            )
        )
    elif action == "set":
        if len(args) >= 2:
            cfg.set(args[0], args[1])
            console.print(f"[green]✅ {args[0]} = {args[1]}[/]")
        else:
            console.print("[red]用法: nbagent config set <key> <value>[/]")


if __name__ == "__main__":
    main()

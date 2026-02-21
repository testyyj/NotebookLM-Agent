"""Built-in skills for NotebookLM Agent."""

from .notebook import NotebookSkill
from .source import SourceSkill
from .chat import ChatSkill
from .generate import GenerateSkill
from .research import ResearchSkill
from .download import DownloadSkill

BUILTIN_SKILLS = [
    NotebookSkill,
    SourceSkill,
    ChatSkill,
    GenerateSkill,
    ResearchSkill,
    DownloadSkill,
]

__all__ = [
    "NotebookSkill",
    "SourceSkill",
    "ChatSkill",
    "GenerateSkill",
    "ResearchSkill",
    "DownloadSkill",
    "BUILTIN_SKILLS",
]

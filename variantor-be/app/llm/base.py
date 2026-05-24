from dataclasses import dataclass
from typing import Protocol


@dataclass
class LLMResponse:
    content: str
    raw_response: str = ""
    provider: str = "mock"
    model: str = "mock"


class LLMProvider(Protocol):
    name: str

    def complete_text(
        self,
        prompt: str,
        *,
        model: str | None = None,
        system_prompt: str | None = None,
    ) -> LLMResponse:
        ...

    def complete_with_file(
        self,
        prompt: str,
        *,
        file_path: str,
        mime_type: str,
        model: str | None = None,
        system_prompt: str | None = None,
    ) -> LLMResponse:
        ...

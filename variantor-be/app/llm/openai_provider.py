import base64
import json
from dataclasses import dataclass
from pathlib import Path

import requests

from app.llm.base import LLMResponse


@dataclass
class OpenAIConfig:
    api_key: str
    model: str
    text_model: str
    api_base_url: str
    timeout: int


class OpenAIProvider:
    name = "openai"

    def __init__(self, config: OpenAIConfig):
        self.config = config
        self.model = config.model or "gpt-5.4"
        self.text_model = config.text_model or self.model
        self.api_base_url = config.api_base_url.rstrip("/")

    def complete_text(
        self,
        prompt: str,
        *,
        model: str | None = None,
        system_prompt: str | None = None,
    ) -> LLMResponse:
        selected_model = model or self.text_model
        raw, content = self._responses_create(selected_model, input_messages(prompt, system_prompt))
        return LLMResponse(content=content, raw_response=raw, provider=self.name, model=selected_model)

    def complete_with_file(
        self,
        prompt: str,
        *,
        file_path: str,
        mime_type: str,
        model: str | None = None,
        system_prompt: str | None = None,
    ) -> LLMResponse:
        selected_model = model or self.model
        image_url = image_data_url(file_path, mime_type)
        raw, content = self._responses_create(
            selected_model,
            input_messages(prompt, system_prompt, image_url=image_url),
        )
        return LLMResponse(content=content, raw_response=raw, provider=self.name, model=selected_model)

    def _responses_create(self, model: str, messages: list[dict]) -> tuple[str, str]:
        if not self.config.api_key:
            raise RuntimeError("OPENAI_API_KEY is required when provider=openai")

        response = requests.post(
            f"{self.api_base_url}/responses",
            headers={
                "Authorization": f"Bearer {self.config.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            json={"model": model, "input": messages},
            timeout=self.config.timeout,
        )
        raw = response.text
        response.raise_for_status()
        payload = json.loads(raw)
        return raw, output_text(payload)


def input_messages(prompt: str, system_prompt: str | None = None, image_url: str | None = None) -> list[dict]:
    messages = []
    if system_prompt:
        messages.append(
            {
                "role": "system",
                "content": [{"type": "input_text", "text": system_prompt}],
            }
        )

    content = [{"type": "input_text", "text": prompt}]
    if image_url:
        content.append({"type": "input_image", "image_url": image_url, "detail": "high"})
    messages.append({"role": "user", "content": content})
    return messages


def image_data_url(file_path: str, mime_type: str) -> str:
    encoded = base64.b64encode(Path(file_path).read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def output_text(payload: dict) -> str:
    if isinstance(payload.get("output_text"), str) and payload["output_text"].strip():
        return payload["output_text"].strip()

    chunks = []
    for item in payload.get("output", []):
        if item.get("type") != "message":
            continue
        for content in item.get("content", []):
            if content.get("type") == "output_text" and content.get("text"):
                chunks.append(str(content["text"]))
    return "\n".join(chunks).strip()

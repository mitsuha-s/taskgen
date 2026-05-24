import json
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

import requests

from app.llm.base import LLMResponse


@dataclass
class GigaChatConfig:
    auth_key: str
    model: str
    text_model: str
    scope: str
    auth_url: str
    api_base_url: str
    verify_tls: bool
    timeout: int


class GigaChatProvider:
    name = "gigachat"

    def __init__(self, config: GigaChatConfig):
        self.config = config
        self._token = ""
        self._expires_at = 0.0
        self.model = config.model or "GigaChat-Pro"
        self.text_model = config.text_model or self.model
        self.api_base_url = normalize_api_base_url(config.api_base_url)

    def complete_text(
        self,
        prompt: str,
        *,
        model: str | None = None,
        system_prompt: str | None = None,
    ) -> LLMResponse:
        selected_model = model or self.text_model
        raw, content = self._chat(selected_model, chat_messages(prompt, system_prompt))
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
        file_id = self._upload_file(file_path, mime_type)
        raw, content = self._chat(selected_model, chat_messages(prompt, system_prompt, attachments=[file_id]))
        return LLMResponse(content=content, raw_response=raw, provider=self.name, model=selected_model)

    def _access_token(self) -> str:
        if self._token and time.time() < self._expires_at - 60:
            return self._token
        if not self.config.auth_key:
            raise RuntimeError("GIGACHAT_AUTH_KEY is not configured")

        response = requests.post(
            self.config.auth_url,
            data={"scope": self.config.scope},
            headers={
                "Authorization": f"Basic {self.config.auth_key}",
                "RqUID": str(uuid.uuid4()),
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            timeout=self.config.timeout,
            verify=self.config.verify_tls,
        )
        response.raise_for_status()
        payload = response.json()
        self._token = payload["access_token"]
        expires_at = payload.get("expires_at")
        self._expires_at = expires_at / 1000 if expires_at and expires_at > 10_000_000_000 else time.time() + 25 * 60
        return self._token

    def _upload_file(self, file_path: str, mime_type: str) -> str:
        token = self._access_token()
        with Path(file_path).open("rb") as file:
            response = requests.post(
                f"{self.api_base_url}/files",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                files={"file": (Path(file_path).name, file, mime_type)},
                data={"purpose": "general"},
                timeout=self.config.timeout,
                verify=self.config.verify_tls,
            )
        response.raise_for_status()
        payload = response.json()
        return payload["id"]

    def _chat(self, model: str, messages: list[dict]) -> tuple[str, str]:
        token = self._access_token()
        response = requests.post(
            f"{self.api_base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json={"model": model, "messages": messages, "temperature": 0.2, "stream": False},
            timeout=self.config.timeout,
            verify=self.config.verify_tls,
        )
        raw = response.text
        response.raise_for_status()
        payload = json.loads(raw)
        return raw, payload["choices"][0]["message"]["content"].strip()


def chat_messages(prompt: str, system_prompt: str | None = None, attachments: list[str] | None = None) -> list[dict]:
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    user_message = {"role": "user", "content": prompt}
    if attachments:
        user_message["attachments"] = attachments
    messages.append(user_message)
    return messages


def normalize_api_base_url(api_base_url: str) -> str:
    normalized = api_base_url.rstrip("/")
    for endpoint in ("/chat/completions", "/files"):
        while normalized.endswith(endpoint):
            normalized = normalized[: -len(endpoint)]
    return normalized

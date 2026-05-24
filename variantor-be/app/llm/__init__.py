from app.config import Config
from app.llm.base import LLMProvider
from app.llm.gigachat import GigaChatConfig, GigaChatProvider
from app.llm.mock import MockProvider
from app.llm.openai_provider import OpenAIConfig, OpenAIProvider


def create_provider(config: Config, provider_name: str | None = None) -> LLMProvider:
    provider = (provider_name or config.LLM_PROVIDER).strip().lower()
    if provider == "mock":
        return MockProvider()
    if provider == "gigachat":
        if not config.GIGACHAT_AUTH_KEY:
            raise RuntimeError("GIGACHAT_AUTH_KEY is required when LLM_PROVIDER=gigachat")
        return GigaChatProvider(
            GigaChatConfig(
                auth_key=config.GIGACHAT_AUTH_KEY,
                model=config.GIGACHAT_MODEL,
                text_model=config.GIGACHAT_TEXT_MODEL,
                scope=config.GIGACHAT_SCOPE,
                auth_url=config.GIGACHAT_AUTH_URL,
                api_base_url=config.GIGACHAT_API_BASE_URL,
                verify_tls=config.GIGACHAT_VERIFY_TLS,
                timeout=config.GIGACHAT_TIMEOUT,
            )
        )
    if provider == "openai":
        if not config.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY is required when provider=openai")
        return OpenAIProvider(
            OpenAIConfig(
                api_key=config.OPENAI_API_KEY,
                model=config.OPENAI_MODEL,
                text_model=config.OPENAI_TEXT_MODEL,
                api_base_url=config.OPENAI_API_BASE_URL,
                timeout=config.OPENAI_TIMEOUT,
            )
        )
    raise RuntimeError(f"Unsupported LLM provider: {provider}")

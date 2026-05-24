from app.config import Config
from app.llm.base import LLMProvider
from app.llm.gigachat import GigaChatConfig, GigaChatProvider
from app.llm.mock import MockProvider


def create_provider(config: Config) -> LLMProvider:
    if config.LLM_PROVIDER == "mock":
        return MockProvider()
    if config.LLM_PROVIDER == "gigachat":
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
    raise RuntimeError(f"Unsupported LLM_PROVIDER: {config.LLM_PROVIDER}")

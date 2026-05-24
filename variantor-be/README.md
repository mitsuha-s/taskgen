# variantor-be

Flask backend новой раздельной версии "Вариантора" с API-контрактом старого `old_variantor`.

## Локальный запуск

```bash
cd /Users/alex/Sites/variantor
docker compose up --build
```

Frontend будет доступен на `http://127.0.0.1:18080`.

## Проверка backend

```bash
curl http://127.0.0.1:18080/healthz
curl http://127.0.0.1:18080/api/health
```

## Auth

По умолчанию используются учетные данные старого прототипа:

- email: `teacher@example.com`
- password: `secret`

Сессия хранится в cookie `ta_session`.

## Workflow API

Frontend работает по старому контракту:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`
- `POST /api/assignments`
- `GET /api/assignments/<assignment_id>`
- `POST /api/assignments/<assignment_id>/image`
- `POST /api/assignments/<assignment_id>/extract`
- `GET /api/extraction-runs/<run_id>`
- `POST /api/extraction-runs/<run_id>/continue`
- `PUT /api/extraction-runs/<run_id>/steps/<step>`
- `POST /api/extraction-runs/<run_id>/steps/<step>/regenerate`
- `GET /api/files/assignments/<assignment_id>/original`

## Prompts

Все LLM-инструкции вынесены в `prompts/task_processing_pipeline_v1`.

- `prompts/README.md` - правила работы с prompt workspace.
- `prompts/task_processing_pipeline_v1/manifest.json` - единая карта prompt-файлов, переменных и назначения.
- `step1_image_to_html.md` - распознавание изображения в HTML.
- `step2_parameters.md`, `step3_generate_variant.md`, `step4_self_evaluate.md` - следующие шаги старого пайплайна.

Prompt loader проверяет, что переменные в `.md` файлах совпадают с `manifest.json`.

## LLM-провайдеры

Сейчас доступны `mock`, `gigachat` и `openai`. Новый провайдер добавляется через реализацию интерфейса в `app/llm/base.py` и регистрацию в `app/llm/__init__.py`.

## Runtime limits

- `MAX_UPLOAD_BYTES` ограничивает размер изображения на уровне Flask request.
- `ALLOWED_UPLOAD_EXTENSIONS` задает разрешенные расширения изображений.
- `MAX_VARIANT_COUNT` ограничивает количество вариантов на шаге генерации.

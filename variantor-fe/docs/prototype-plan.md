# Вариантор: план первого прототипа новой версии

## Цель

Собрать первый рабочий прототип новой версии "Вариантора": React/Vite frontend в текущем визуальном стиле, Python/Flask backend, Postgres для хранения заданий и запусков обработки, контейнеры для локального запуска и деплоя.

Главное отличие новой версии: поддержка основных школьных предметов, а не только английского языка.

## Исходный контекст

- Старая версия: `/Users/alex/Sites/old_variantor`.
- Новый frontend: `/Users/alex/Sites/variantor-fe`.
- Новый backend: `/Users/alex/Sites/variantor-be`.
- Из старой версии берем только порядок шагов и тексты промптов.
- Данные GigaChat берем из `/Users/alex/Sites/old_variantor/.env`, значения секретов не выводим в лог.

## Порядок пайплайна из старой версии

1. Распознать загруженный файл задания и привести его к HTML.
2. Определить параметры каждого задания: тип, предмет, класс, сложность, тема.
3. Сгенерировать новый вариант с сохранением структуры, предметной логики и сложности.
4. Выполнить самооценку сгенерированного варианта по шкале 1-10.

## Архитектура backend

Backend будет Flask-приложением с модульной структурой:

- `app/config.py` - конфигурация из переменных окружения.
- `app/db.py` - подключение к Postgres и выполнение миграций.
- `app/api.py` - HTTP API.
- `app/pipeline/service.py` - orchestration шагов 1-4.
- `app/pipeline/prompts.py` - загрузка prompt set из файлов.
- `app/llm/base.py` - интерфейс провайдера LLM.
- `app/llm/gigachat.py` - реализация GigaChat.
- `app/llm/mock.py` - локальный deterministic fallback для разработки.
- `prompts/task_processing_pipeline_v1` - адаптированные промпты под все школьные предметы.
- `migrations` - SQL-миграции.

LLM-провайдеры подключаются через общий интерфейс. Чтобы добавить другого провайдера позже, нужно будет реализовать класс с методами `complete_text` и `complete_with_file`, затем зарегистрировать его в фабрике.

## API первого прототипа

- `GET /api/health` - состояние backend.
- `POST /api/assignments` - создать задание, загрузить файл, создать run.
- `GET /api/assignments/<id>` - получить задание.
- `GET /api/extraction-runs/<id>` - получить запуск пайплайна.
- `POST /api/extraction-runs/<id>/steps/1` - распознать образец в HTML.
- `POST /api/extraction-runs/<id>/steps/2` - извлечь параметры заданий.
- `POST /api/extraction-runs/<id>/steps/3` - сгенерировать вариант.
- `POST /api/extraction-runs/<id>/steps/4` - выполнить самооценку и вернуть вариант.
- `POST /api/extraction-runs/<id>/generate` - совместимый shortcut для шагов 3-4.

Первый прототип делает обработку синхронно в рамках запроса. Это проще для проверки. Позже можно заменить execution на очередь без изменения frontend-контракта.

## Модель данных

Таблицы:

- `assignments`: предмет, количество вариантов, исходный файл, статус, timestamps.
- `extraction_runs`: статус, текущий шаг, provider/model, prompt version, `step_results`, `parsed_content`, ошибка.

Файлы хранятся в локальном volume `/app/storage/uploads`.

## Frontend изменения

Сохраняем текущий интерфейс `/Users/alex/Sites/variantor-fe`:

- файловый input "Образец задания" остается основной точкой загрузки;
- первый экран отправляет файл, предмет и количество вариантов на backend;
- экран review показывает распознанные задания и параметры;
- кнопка "Генерация варианта 1" вызывает backend и отображает результат;
- локальные стабы заменяются API-клиентом с нормализацией ответа.

Мобильную версию в этом этапе не дорабатываем.

## Docker

Контейнеры:

- `postgres` на базе `postgres:17-alpine`;
- `backend` на базе Python slim + Gunicorn;
- `frontend` на базе Node 24 build stage и Nginx runtime.

Compose-файл будет лежать в `/Users/alex/Sites/variantor-be/docker-compose.yml` и собирать frontend из `../variantor-fe`.

## Проверка

Без Playwright и анализа картинок:

1. `nvm exec 24 npm run build` во frontend.
2. `python -m compileall app` или equivalent для backend.
3. По возможности `docker compose config`.
4. Легкий health/API smoke test без вызова LLM, чтобы не расходовать токены.

## Риски и ограничения прототипа

- PDF/DOCX OCR в первом прототипе зависит от LLM-провайдера. Текстовые файлы можно обработать локально.
- GigaChat-вызовы не дергаем без необходимости, чтобы не тратить токены.
- Очереди и авторизацию пока не добавляем, чтобы быстрее получить проверяемый end-to-end флоу.

# Ассистент учителя английского

## Запуск в Docker

```bash
docker compose up --build
```

Откройте `http://localhost:18080/login`.

Данные входа по умолчанию:

```text
teacher@example.com
secret
```

В Compose поднимаются:

- `postgres` на `localhost:5432`;
- `backend` на `localhost:18080`, он же отдает собранный frontend и все `/api/*`.

Для публикации на стандартном HTTP-порту задайте `APP_PORT=80` в `.env` рядом с `docker-compose.yml`.

## Деплой

На слабом VPS не собирайте образ на сервере. Инструкция для локальной сборки image и загрузки готового архива на сервер: [DEPLOY.md](DEPLOY.md).

## Промпты

Тексты промптов вынесены из Go-кода в `prompts/task_processing_pipeline_v1`. Backend читает активный набор из `PROMPTS_DIR`; в Docker Compose директория промптов монтируется в контейнер read-only, поэтому текст промптов можно обновлять без пересборки image.

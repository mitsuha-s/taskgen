# Variantor

Монорепозиторий для Flask backend и React/Vite frontend проекта Variantor.

## Структура

- `variantor-be/` - Flask API, миграции БД, prompt pipeline и LLM-провайдеры.
- `variantor-fe/` - React/Vite frontend, в Docker отдается через nginx.
- `docker-compose.yml` - локальная full-stack среда из корня репозитория.
- `deploy/docker-compose.prod.yml` - production Compose для GitHub Actions.
- `.github/workflows/ci.yml` - проверки backend, frontend и Docker Compose.
- `.github/workflows/deploy.yml` - публикация образов в GHCR и деплой по SSH.

## Локальный запуск в Docker

```bash
cp .env.example .env
docker compose up --build
```

Приложение будет доступно на `http://127.0.0.1:18080`.

Проверка:

```bash
curl http://127.0.0.1:18080/healthz
curl http://127.0.0.1:18080/api/health
```

Локальные учетные данные по умолчанию:

- email: `teacher@example.com`
- password: `secret`

## Команды разработки

```bash
npm run dev:frontend
npm run dev:backend
npm run lint
npm run build
npm run check:backend
```

Есть эквивалентные Make targets:

```bash
make dev
make check
make compose-config
```

Для прямой работы с frontend:

```bash
npm --prefix variantor-fe ci
npm --prefix variantor-fe run dev
```

Для прямой работы с backend:

```bash
make backend-install
source variantor-be/.venv/bin/activate
npm run dev:backend
```

Vite проксирует `/api` на `http://127.0.0.1:5000`, поэтому при раздельной разработке backend должен быть доступен на порту `5000`.

## Деплой через GitHub Actions

Workflow `Deploy` собирает и публикует два Docker-образа в GHCR:

- `ghcr.io/<owner>/<repo>/backend:<sha>`
- `ghcr.io/<owner>/<repo>/frontend:<sha>`

После этого workflow копирует `deploy/docker-compose.prod.yml` на сервер и выполняет `docker compose pull && docker compose up -d`.

Обязательные GitHub environment secrets для `production`:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `POSTGRES_PASSWORD`
- `AUTH_PASSWORD`

Опциональные secrets:

- `GIGACHAT_AUTH_KEY`
- `GHCR_TOKEN` - нужен только если сервер скачивает приватные GHCR-образы.

Полезные GitHub environment variables:

- `DEPLOY_PATH` - default `/opt/variantor`
- `DEPLOY_PORT` - default `22`
- `APP_PORT` - default `18080`
- `APP_ENV` - default `production`
- `CORS_ALLOWED_ORIGIN` - публичный origin frontend, например `https://variantor.example.com`
- `POSTGRES_DB` - default `variantor`
- `POSTGRES_USER` - default `app`
- `AUTH_EMAIL` - default `teacher@example.com`
- `LLM_PROVIDER` - default `mock`
- `GIGACHAT_MODEL`
- `GIGACHAT_TEXT_MODEL`

На сервере нужен Docker с Compose plugin.

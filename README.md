# Variantor

Монорепозиторий для Flask backend и React/Vite frontend проекта Variantor.

## Структура

- `variantor-be/` - Flask API, миграции БД, prompt pipeline и LLM-провайдеры.
- `variantor-fe/` - React/Vite frontend, в Docker отдается через nginx.
- `docker-compose.yml` - локальная full-stack среда из корня репозитория.
- `deploy/docker-compose.server.yml` - production Compose для сборки и запуска на сервере.
- `deploy/post-receive.server` - Git hook для деплоя push'ем в bare repository.

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

## Деплой push'ем на сервер

На сервере используется bare repository `/opt/variantor.git` и рабочая копия `/opt/variantor`.
Push в remote `server` запускает hook `deploy/post-receive.server`, который делает checkout,
собирает Docker-образы из исходников и выполняет `docker compose up -d --build --remove-orphans`.

```bash
git remote add server root@217.199.254.88:/opt/variantor.git
git push server master
```

Секреты и runtime-настройки лежат только на сервере в `/opt/variantor/.env`.
Для GigaChat должны быть заданы `LLM_PROVIDER=gigachat` и `GIGACHAT_AUTH_KEY`.
На сервере нужен Docker с Compose plugin.

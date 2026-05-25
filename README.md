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

## Деплой на сервер `217.199.254.88`

Приложение публикуется на `http://217.199.254.88/`. Деплой сделан через обычный `git push`
в отдельный Git remote на сервере. GitHub Actions для этого не нужны.

### Как это работает

На сервере есть два каталога:

- `/opt/variantor.git` - bare repository, то есть Git-репозиторий без рабочей папки.
- `/opt/variantor` - рабочая копия приложения, из которой запускаются Docker-контейнеры.

Когда вы делаете `git push server master`, сервер принимает новый коммит в `/opt/variantor.git`.
После push автоматически запускается Git hook `/opt/variantor.git/hooks/post-receive`.
Hook делает checkout кода в `/opt/variantor`, проверяет swap, собирает Docker-образы и запускает:

```bash
docker compose --env-file /opt/variantor/.env -f /opt/variantor/deploy/docker-compose.server.yml -p variantor up -d --build --remove-orphans
```

### Первый раз на новом компьютере

Проверьте, что вы находитесь в корне проекта:

```bash
pwd
```

Добавьте remote `server`:

```bash
git remote add server root@217.199.254.88:/opt/variantor.git
```

Если remote уже добавлен, команда выше напишет ошибку. Тогда можно просто проверить:

```bash
git remote -v
```

В списке должен быть:

```text
server  root@217.199.254.88:/opt/variantor.git (fetch)
server  root@217.199.254.88:/opt/variantor.git (push)
```

### Обычный деплой

Сначала закоммитьте изменения:

```bash
git status
git add .
git commit -m "Describe your change"
```

Затем отправьте ветку `master` на сервер:

```bash
git push server master
```

После этого дождитесь завершения вывода в терминале. В конце должно быть что-то вроде:

```text
deployment finished
variantor-backend-1    Up ... (healthy)
variantor-frontend-1   Up ...
variantor-postgres-1   Up ... (healthy)
```

Проверка с локальной машины:

```bash
curl http://217.199.254.88/healthz
curl http://217.199.254.88/api/health
```

### Что пушить

Пушить нужно именно ветку `master`:

```bash
git push server master
```

Если вы работаете в другой ветке, сначала влейте изменения в `master` или явно пушьте локальную ветку в удаленный `master`:

```bash
git push server your-branch:master
```

### Секреты и настройки

Секреты не хранятся в Git. Они лежат только на сервере:

```text
/opt/variantor/.env
```

Для GigaChat должны быть заданы:

```env
LLM_PROVIDER=gigachat
GIGACHAT_AUTH_KEY=...
```

Для OpenAI добавьте ключ так, чтобы он не попал в историю shell:

```bash
ssh root@217.199.254.88
read -rsp "OPENAI_API_KEY: " key
printf "\nOPENAI_API_KEY=%s\n" "$key" >> /opt/variantor/.env
unset key
docker compose --env-file /opt/variantor/.env -f /opt/variantor/deploy/docker-compose.server.yml -p variantor up -d
```

Проверить доступные LLM-провайдеры:

```bash
curl http://217.199.254.88/api/llm/options
```

У OpenAI должно быть `"configured": true`.

### Полезные команды на сервере

Посмотреть контейнеры:

```bash
ssh root@217.199.254.88 'docker ps'
```

Посмотреть логи backend:

```bash
ssh root@217.199.254.88 'docker logs --tail=100 variantor-backend-1'
```

Посмотреть лог деплоя:

```bash
ssh root@217.199.254.88 'tail -n 120 /var/log/variantor-deploy.log'
```

На сервере уже настроен swap `/swapfile` на 2 GB. Hook также умеет создать его автоматически, если swap выключен.

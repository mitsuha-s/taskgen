# Деплой на слабый VPS без сборки на сервере

Сервер `217.199.254.88` слабый, поэтому не запускайте на нем `docker compose up --build`: сборка frontend/backend может забить CPU до 100% и подвесить SSH/HTTP.

Правильный процесс:

1. Собрать Docker image локально под архитектуру сервера `linux/amd64`.
2. Упаковать готовый image в архив.
3. Передать архив на сервер.
4. На сервере выполнить только `docker load` и перезапуск backend без build.

## Переменные

```bash
SERVER=root@217.199.254.88
REMOTE_DIR=/opt/teacher-assistant
IMAGE=teacher-assistant-backend:latest
ARCHIVE=/private/tmp/teacher-assistant-backend-amd64.tar.gz
```

Если на macOS команда `docker` не найдена, но установлен Docker Desktop:

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
```

## 1. Проверить сервер

```bash
ssh -o BatchMode=yes -o ConnectTimeout=15 "$SERVER" \
  "uname -m && docker compose --project-directory $REMOTE_DIR -f $REMOTE_DIR/docker-compose.yml ps"
```

Ожидаемая архитектура VPS: `x86_64`. Для нее нужен образ `linux/amd64`.

## 2. Собрать image локально

В корне проекта:

```bash
docker buildx build --platform linux/amd64 -t "$IMAGE" --load .
```

Проверить, что образ действительно `linux/amd64`:

```bash
docker image inspect "$IMAGE" --format '{{.Id}} {{.Os}}/{{.Architecture}} {{.Size}}'
```

В выводе должно быть:

```text
linux/amd64
```

## 3. Упаковать image

```bash
docker save -o /private/tmp/teacher-assistant-backend-amd64.tar "$IMAGE"
gzip -f /private/tmp/teacher-assistant-backend-amd64.tar
ls -lh "$ARCHIVE"
```

## 4. Передать архив на сервер

```bash
rsync -az --progress "$ARCHIVE" "$SERVER:$REMOTE_DIR/teacher-assistant-backend-amd64.tar.gz"
```

## 5. Загрузить image на сервере

```bash
ssh -o BatchMode=yes -o ConnectTimeout=15 "$SERVER" \
  "gunzip -c $REMOTE_DIR/teacher-assistant-backend-amd64.tar.gz | docker load"
```

В норме будет:

```text
Loaded image: teacher-assistant-backend:latest
```

## 6. Перезапустить backend без сборки

```bash
ssh -o BatchMode=yes -o ConnectTimeout=15 "$SERVER" \
  "docker compose --project-directory $REMOTE_DIR -f $REMOTE_DIR/docker-compose.yml up -d --no-build --force-recreate --no-deps backend"
```

`--no-deps` не трогает Postgres. Volume с базой и uploads не пересоздаются.

Если сервер только что перезагружался и контейнеры не запущены, сначала можно поднять существующие контейнеры без сборки:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=15 "$SERVER" \
  "docker compose --project-directory $REMOTE_DIR -f $REMOTE_DIR/docker-compose.yml up -d --no-build"
```

## 7. Проверить результат

```bash
curl -I --max-time 10 http://217.199.254.88/
```

Ожидаемый ответ:

```text
HTTP/1.1 200 OK
```

Проверить контейнеры:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=15 "$SERVER" \
  "docker compose --project-directory $REMOTE_DIR -f $REMOTE_DIR/docker-compose.yml ps"
```

Проверить нагрузку:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=15 "$SERVER" \
  "docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}' teacher-assistant-backend-1 teacher-assistant-postgres-1"
```

Проверить последние логи backend:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=15 "$SERVER" \
  "docker compose --project-directory $REMOTE_DIR -f $REMOTE_DIR/docker-compose.yml logs --tail=80 backend"
```

## Что нельзя делать на VPS

Не запускать:

```bash
docker compose up --build
docker compose build
```

Эти команды собирают frontend и Go backend на сервере и могут снова подвесить VPS.

## Если изменился docker-compose.yml

Если менялись только frontend/backend исходники, достаточно передать новый image. Если менялся `docker-compose.yml`, `.env.example`, `Dockerfile`, certs или другие файлы, которые должны лежать в `/opt/teacher-assistant`, синхронизируйте проект отдельно, не перезаписывая серверный `.env`:

```bash
rsync -az --delete \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude '.env.deploy.bak.*' \
  --exclude '.cache/' \
  --exclude '.vscode/' \
  --exclude 'frontend/node_modules/' \
  --exclude 'frontend/dist/' \
  ./ "$SERVER:$REMOTE_DIR/"
```

После этого все равно используйте только `up -d --no-build`.

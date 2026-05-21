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

Файлы:

- `manifest.json` — версия prompt set и список файлов.
- `step1_image_to_html.md` — распознавание изображения в HTML.
- `step2_parameters.md` — определение параметров задания.
- `step3_generate_variant.md` — генерация нового варианта.
- `step4_self_evaluate.md` — самооценка результата.
- `default_source.html` — демо-HTML вместо загруженного изображения.

Если изменился только текст промпта, пересобирать Docker image не нужно. Перед отправкой на сервер проверьте, что backend загружает prompt set:

```bash
cd backend
/usr/local/go/bin/go test ./internal/extraction
```

Обновите промпты на сервере:

```bash
SERVER=root@217.199.254.88
REMOTE_DIR=/opt/teacher-assistant

rsync -az --delete \
  prompts/task_processing_pipeline_v1/ \
  "$SERVER:$REMOTE_DIR/prompts/task_processing_pipeline_v1/"
```

Перезапустите backend без сборки:

```bash
ssh -o BatchMode=yes -o ConnectTimeout=15 "$SERVER" \
  "docker compose --project-directory $REMOTE_DIR -f $REMOTE_DIR/docker-compose.yml restart backend"
```

Проверьте, что сервис поднялся и загрузил prompt set:

```bash
curl -I --max-time 10 http://217.199.254.88/

ssh -o BatchMode=yes -o ConnectTimeout=15 "$SERVER" \
  "docker compose --project-directory $REMOTE_DIR -f $REMOTE_DIR/docker-compose.yml logs --tail=40 backend"
```

Не меняйте промпты во время активной обработки задания. Дождитесь завершения текущего `extraction_run`, затем обновляйте файлы и перезапускайте backend.

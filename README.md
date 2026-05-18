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

# Micro Sentry (минимальный сервер)

Минимальный аналог Sentry: принимает `envelope` события и показывает UI с issue/stacktrace за последние 24 часа (данные в памяти процесса).

## Запуск

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Откройте в браузере: `http://localhost:8000`

## Ingest endpoint

- `POST /api/{project_id}/envelope/`
- Поддерживается `Content-Encoding: gzip`

## Docker

Сборка образа:

```bash
docker build -t micro-sentry:local .
```

Запуск:

```bash
docker run --rm -p 8000:8000 micro-sentry:local
```

Порт/хост можно переопределить:

```bash
docker run --rm -e PORT=8011 -p 8011:8011 micro-sentry:local
```

Пример подключения из другого проекта (DSN):

- локально без Docker: `http://public@127.0.0.1:8000/1`
- через docker-compose (service name `micro-sentry`): `http://public@micro-sentry:8000/1`


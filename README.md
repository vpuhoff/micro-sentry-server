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


import os
import random
import time

import sentry_sdk


class CustomError(RuntimeError):
    pass


def _zero_division():
    return 1 / 0


def _missing_key():
    d = {"ok": 1}
    return d["missing"]


def _bad_int():
    return int("not-a-number")


def _timeout():
    raise TimeoutError("simulated timeout while calling dependency")


def _custom():
    raise CustomError("custom domain error: payment declined")


def _chained():
    try:
        _bad_int()
    except Exception as e:
        raise ValueError("outer error with explicit cause") from e


def _random_message():
    sentry_sdk.capture_message(
        f"test message ping={random.randint(1000, 9999)}", level="warning"
    )


def _capture_event(title: str, fn):
    sentry_sdk.add_breadcrumb(
        category="test",
        message=f"about to run: {title}",
        level="info",
    )

    with sentry_sdk.new_scope() as scope:
        scope.set_tag("case", title)
        scope.set_tag("script", "simulate_sentry_error.py")
        scope.set_extra("ts", time.time())
        scope.set_extra("rand", random.random())

        try:
            fn()
        except Exception as e:
            sentry_sdk.capture_exception(e)
        else:
            sentry_sdk.capture_message(f"{title}: completed without exception", level="info")


def main():
    # Пример DSN для этого Micro Sentry:
    # http://public@127.0.0.1:8011/1
    dsn = os.environ.get("SENTRY_DSN", "http://public@127.0.0.1:8011/1")

    sentry_sdk.init(
        dsn=dsn,
        traces_sample_rate=0.0,
        send_default_pii=False,
        release="demo@local",
        environment=os.environ.get("SENTRY_ENV", "local"),
    )

    # Небольшая задержка, чтобы SDK успел поднять transport (на всякий случай).
    time.sleep(0.1)

    # Разные типы событий: исключения, цепочки, сообщения.
    cases = [
        ("zero_division", _zero_division),
        ("missing_key", _missing_key),
        ("bad_int", _bad_int),
        ("timeout", _timeout),
        ("custom_error", _custom),
        ("chained_exception", _chained),
        ("message_only", _random_message),
    ]

    for title, fn in cases:
        _capture_event(title, fn)

    # Дождаться отправки всех событий.
    sentry_sdk.flush(timeout=5)
    print(f"Отправлено {len(cases)} событий. DSN={dsn}")


if __name__ == "__main__":
    main()


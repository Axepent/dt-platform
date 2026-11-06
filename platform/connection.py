"""Створює або оновлює MQTT-з'єднання Ditto і перевіряє його стан."""

import json
from pathlib import Path
import time

import requests


HERE = Path(__file__).resolve().parent
URL = "http://127.0.0.1:8080/api/2/connections/mqtt-telemetry"
DEVOPS = ("devops", "foobar")


def main():
    connection = json.loads((HERE / "connection.json").read_text(encoding="utf-8-sig"))
    script = (HERE / "mapping.js").read_text(encoding="utf-8-sig")
    connection["mappingDefinitions"]["telemetry"]["options"]["incomingScript"] = script

    try:
        response = requests.put(URL, json=connection, auth=DEVOPS, timeout=30)
        print(f"Налаштування з'єднання: HTTP {response.status_code}")
        if not response.ok:
            raise SystemExit(response.text)

        for _ in range(10):
            response = requests.get(f"{URL}/status", auth=DEVOPS, timeout=10)
            if not response.ok:
                raise SystemExit(f"HTTP {response.status_code}: {response.text}")
            status = response.json()
            state = status.get("liveStatus") or status.get("connectionStatus")
            if state == "open":
                print("Стан з'єднання: open")
                return
            time.sleep(1)
    except (requests.RequestException, ValueError) as error:
        raise SystemExit(f"Помилка звернення до Ditto: {error}") from error

    raise SystemExit(f"З'єднання ще не відкрилося. Відповідь /status: {response.text}")


if __name__ == "__main__":
    main()

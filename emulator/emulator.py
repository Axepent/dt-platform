"""Публікує знімки стану манекена через MQTT і записує їх у results/source.csv."""

import argparse
import csv
from itertools import groupby
import json
import math
from pathlib import Path
import re
import time

import paho.mqtt.client as mqtt

from sensor_emulator import SensorEmulator


FIELDS = {
    "S-01": "sh", "S-02": "el", "S-03": "hip", "S-04": "kn",
    "S-05": "hd", "S-06": "tor", "S-07": "i", "S-08": "t",
    "S-09": "v", "S-10": "lim", "S-11": "est",
}
EVENTS = {"S-10", "S-11"}
SOURCE_CSV = Path(__file__).resolve().parents[1] / "results" / "source.csv"


def frames(name, rate):
    """Повертає час моделі й останній знімок, включно зі змінами входів безпеки."""
    readings = SensorEmulator(device_id=name).samples(duration=None)
    latest = {}
    current = []
    voltage = []
    window = 0
    next_frame = 0.0
    rms = mean_voltage = None
    for elapsed, batch in groupby(readings, key=lambda sample: sample.sim_time_s):
        if int(elapsed) > window:
            rms = math.sqrt(sum(value ** 2 for value in current) / len(current))
            mean_voltage = sum(voltage) / len(voltage)
            current.clear()
            voltage.clear()
            window = int(elapsed)

        event = False
        for sample in batch:
            sid = sample.sensor_id
            latest[sid] = sample.value
            if sid == "S-07":
                current.append(sample.value)
            elif sid == "S-09":
                voltage.append(sample.value)
            elif sid in EVENTS:
                event = True

        regular = elapsed + 1e-9 >= next_frame
        if regular:
            next_frame += 1 / rate
        if regular or event:
            payload = {field: latest[sid] for sid, field in FIELDS.items()}
            if rms is not None:
                payload["i"] = round(rms, 4)
                payload["v"] = round(mean_voltage, 4)
            yield elapsed, payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", default="mannequin-01", help="ім’я двійника")
    parser.add_argument("--rate", type=float, default=1, help="планових повідомлень за секунду (до 10)")
    parser.add_argument("--count", type=int, default=0, help="кількість повідомлень, 0 — без обмеження")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_-]+", args.name):
        parser.error("--name може містити лише літери A–Z, цифри, дефіс і підкреслення")
    if not math.isfinite(args.rate) or not 0 < args.rate <= 10:
        parser.error("--rate має бути в межах (0, 10]")
    if args.count < 0:
        parser.error("--count має бути невід’ємним")

    topic = f"pzks/{args.name}/telemetry"
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    sent = 0
    try:
        client.connect("127.0.0.1", 1883)
        client.loop_start()
        SOURCE_CSV.parent.mkdir(parents=True, exist_ok=True)
        print(f"Публікація в {topic}, QoS 1. Ctrl+C — зупинка.", flush=True)
        with SOURCE_CSV.open("w", encoding="utf-8", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=["seq", "ts", *FIELDS.values()])
            writer.writeheader()
            started = time.monotonic()
            for elapsed, payload in frames(args.name, args.rate):
                time.sleep(max(0.0, started + elapsed - time.monotonic()))
                message = {"seq": sent + 1, "ts": time.time_ns() // 1_000_000, **payload}
                info = client.publish(topic, json.dumps(message, separators=(",", ":")), qos=1)
                info.wait_for_publish(timeout=5)
                if not info.is_published():
                    raise RuntimeError(f"Брокер не підтвердив повідомлення seq={message['seq']}")
                writer.writerow({
                    key: json.dumps(value) if isinstance(value, bool) else value
                    for key, value in message.items()
                })
                file.flush()
                sent += 1
                if args.count and sent == args.count:
                    break
    except KeyboardInterrupt:
        pass
    except (OSError, RuntimeError, ValueError) as error:
        parser.exit(1, f"Помилка MQTT або CSV: {error}\n")
    finally:
        client.disconnect()
        client.loop_stop()
    print(f"Підтверджено брокером і записано у CSV: {sent}")


if __name__ == "__main__":
    main()

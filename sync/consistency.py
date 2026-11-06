"""Порівнює останній сеанс емулятора з історією InfluxDB та станом Ditto."""

import csv
import math
import os
import statistics
from pathlib import Path

import requests
from influxdb_client import InfluxDBClient
from influxdb_client.rest import ApiException

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
THING = "org.pzks:mannequin-01"
API = f"http://127.0.0.1:8090/api/2/things/{THING}"
TARGET_MS = 250
FIELDS = {
    "sh": ("pose", "shoulderAngle"),
    "el": ("pose", "elbowAngle"),
    "hip": ("pose", "hipAngle"),
    "kn": ("pose", "kneeAngle"),
    "hd": ("pose", "headAngle"),
    "tor": ("pose", "torsoAngle"),
    "i": ("drive", "current"),
    "t": ("drive", "temperature"),
    "v": ("power", "voltage"),
    "lim": ("safety", "limitSwitchActive"),
    "est": ("safety", "emergencyStopActive"),
}
BOOL_FIELDS = {"lim", "est"}


def source():
    samples = {}
    with (RESULTS / "source.csv").open(encoding="utf-8-sig", newline="") as file:
        for row in csv.DictReader(file):
            key = (int(row["seq"]), int(row["ts"]))
            if key in samples:
                raise ValueError(f"Дубль відліку в source.csv: {key}")
            samples[key] = row
    if not samples:
        raise ValueError("У results/source.csv немає відліків")
    return samples


def history(samples):
    stamps = [ts for _, ts in samples]
    start = min(stamps) * 1_000_000
    stop = (max(stamps) + 1) * 1_000_000
    query = f'''from(bucket: "twin")
      |> range(start: time(v: {start}), stop: time(v: {stop}))
      |> filter(fn: (r) => r._measurement == "twin_state" and r.thing == "{THING}")
      |> map(fn: (r) => ({{r with time_ns: int(v: r._time)}}))'''
    with InfluxDBClient(
        url="http://127.0.0.1:8086", org="pzks",
        token=os.getenv("INFLUX_TOKEN") or "dt-lab-token",
    ) as client:
        tables = client.query_api().query(query)

    # Ключ із наносекундами зберігає різні відліки в межах однієї мілісекунди.
    points = {}
    for table in tables:
        for record in table.records:
            point = points.setdefault(record.values["time_ns"], {})
            point[record.get_field()] = record.get_value()

    matched = {}
    for point in points.values():
        key = (point.get("seq"), point.get("ts"))
        if key in samples:
            matched[key] = point
    return matched


def field_matches(key, sent, actual):
    if key in BOOL_FIELDS:
        expected = sent.strip().lower()
        if expected not in {"true", "false"}:
            raise ValueError(f"Некоректне логічне значення в CSV: {key}={sent!r}")
        return type(actual) is bool and actual == (expected == "true")
    return type(actual) in (int, float) and math.isclose(
        float(sent), actual, rel_tol=0, abs_tol=1e-9,
    )


def report(samples, recorded, features):
    missing = sorted(samples.keys() - recorded.keys())
    wrong = sorted(
        key for key, point in recorded.items()
        if any(not field_matches(field, samples[key][field], point.get(prop))
               for field, (_, prop) in FIELDS.items())
    )
    ordered = sorted(recorded.items(), key=lambda item: item[1]["revision"])
    reordered = sum(b[0][0] < a[0][0] for a, b in zip(ordered, ordered[1:]))
    revisions = {point["revision"] for point in recorded.values()}
    gaps = max(revisions) - min(revisions) + 1 - len(revisions) if revisions else 0

    last = max(samples)
    sync = features.get("sync", {}).get("properties", {})
    final_ok = (sync.get("seq"), sync.get("ts")) == last and all(
        field_matches(field, samples[last][field],
                      features.get(feature, {}).get("properties", {}).get(prop))
        for field, (feature, prop) in FIELDS.items()
    )
    delays = sorted(point["sync_ms"] for point in recorded.values())
    latency = "немає даних"
    if delays:
        p50 = statistics.median(delays)
        p95 = delays[math.ceil(0.95 * len(delays)) - 1]
        verdict = "виконано" if p95 <= TARGET_MS else "не виконано"
        latency = f"{p50:.2f} / {p95:.2f} (ціль p95 ≤ {TARGET_MS} мс, {verdict})"

    return "\n".join([
        "| Перевірка | Результат |",
        "| --- | --- |",
        f"| Надіслано джерелом | {len(samples)} |",
        f"| Є в історії двійника | {len(recorded)} ({len(recorded) / len(samples):.1%}) |",
        f"| Втрачено | {len(missing)} (перші номери: {[seq for seq, _ in missing[:10]]}) |",
        f"| Розбіжності значень | {len(wrong)} (перші номери: {[seq for seq, _ in wrong[:10]]}) |",
        f"| Позачергові оновлення | {reordered} |",
        f"| Пропущені ревізії між отриманими | {gaps if revisions else 'немає даних'} |",
        f"| Кінцевий стан збігається з останнім відліком | {'так' if final_ok else 'ні'} |",
        f"| Затримка синхронізації p50 / p95, мс | {latency} |",
    ])


def main():
    try:
        samples = source()
        recorded = history(samples)
        response = requests.get(API, timeout=10)
        response.raise_for_status()
        result = report(samples, recorded, response.json()["features"])
        (RESULTS / "consistency.md").write_text(result + "\n", encoding="utf-8")
    except (OSError, ValueError, KeyError, requests.RequestException, ApiException) as error:
        raise SystemExit(f"Помилка перевірки узгодженості: {error}") from error
    print(result)


if __name__ == "__main__":
    main()

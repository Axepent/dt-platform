"""Записує стани манекена з Ditto SSE в InfluxDB."""

import json
import os
import sys
import time

import requests
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import WriteOptions


SSE_URL = "http://127.0.0.1:8090/api/2/things"
THING = "org.pzks:mannequin-01"
BUCKET = "twin"
NUMERIC = {
    "pose": ("shoulderAngle", "elbowAngle", "hipAngle", "kneeAngle", "headAngle", "torsoAngle"),
    "drive": ("current", "temperature"),
    "power": ("voltage",),
}
BOOLEAN = ("limitSwitchActive", "emergencyStopActive")


def events():
    params = {"ids": THING, "fields": "thingId,features,_revision"}
    headers = {"Accept": "text/event-stream"}
    with requests.get(SSE_URL, params=params, headers=headers,
                      stream=True, timeout=(5, None)) as response:
        response.raise_for_status()
        if not response.headers.get("Content-Type", "").startswith("text/event-stream"):
            raise ValueError("Ditto не повернув потік SSE")
        response.encoding = "utf-8"
        print(f"Підключено до потоку змін {THING}. Ctrl+C — зупинка", flush=True)
        data = []
        for line in response.iter_lines(chunk_size=None, decode_unicode=True):
            if line.startswith("data:"):
                data.append(line[5:].removeprefix(" "))
            elif not line and data:
                received_ms = time.time_ns() / 1_000_000
                payload = "\n".join(data).strip()
                data.clear()

                if not payload:
                    continue

                try:
                    thing = json.loads(payload)
                except json.JSONDecodeError:
                    print(f"Пропущено SSE без JSON: {payload[:120]!r}",
                          file=sys.stderr, flush=True)
                    continue

                if isinstance(thing, dict) and thing.get("thingId") == THING:
                    yield thing, received_ms


def to_point(thing, received_ms):
    features = thing.get("features", {})
    sync = features.get("sync", {}).get("properties", {})
    ts = sync.get("ts")
    seq = sync.get("seq")
    if type(ts) is not int or ts <= 0 or type(seq) is not int or seq <= 0:
        return None

    point = Point("twin_state").tag("thing", thing["thingId"])
    # Розрізняє відліки, які мають однаковий час джерела в мілісекундах.
    point.time(ts * 1_000_000 + seq % 1_000_000, WritePrecision.NS)
    for feature, names in NUMERIC.items():
        properties = features[feature]["properties"]
        for name in names:
            point.field(name, float(properties[name]))
    for name in BOOLEAN:
        value = features["safety"]["properties"][name]
        if type(value) is not bool:
            raise ValueError(f"Очікується логічне значення для {name}")
        point.field(name, value)
    return (
        point.field("seq", seq)
        .field("ts", ts)
        .field("revision", int(thing["_revision"]))
        .field("sync_ms", float(received_ms - ts))
    )


def main():
    queued = 0
    confirmed = 0
    write_failed = False

    def success(_context, data):
        nonlocal confirmed
        confirmed += len(data.splitlines())

    def failure(_context, _data, error):
        nonlocal write_failed
        write_failed = True
        print(f"Помилка запису в InfluxDB: {error}", file=sys.stderr, flush=True)

    try:
        with InfluxDBClient(url="http://127.0.0.1:8086", org="pzks",
                            token=os.getenv("INFLUX_TOKEN") or "dt-lab-token") as client:
            with client.write_api(
                write_options=WriteOptions(batch_size=500, flush_interval=1000),
                success_callback=success,
                error_callback=failure,
            ) as writer:
                try:
                    for thing, received_ms in events():
                        point = to_point(thing, received_ms)
                        if point is not None:
                            writer.write(bucket=BUCKET, record=point)
                            queued += 1
                except KeyboardInterrupt:
                    pass
    except (requests.RequestException, ValueError, KeyError) as error:
        raise SystemExit(f"Помилка історика: {error}") from error

    print(f"Передано на запис: {queued}; підтверджено InfluxDB: {confirmed}")
    if write_failed or confirmed != queued:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

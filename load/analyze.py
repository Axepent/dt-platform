"""Зіставляє журнал Locust з історією станів манекена в InfluxDB."""

import csv
import math
import os
import statistics
from collections import defaultdict
from pathlib import Path

import matplotlib
from influxdb_client import InfluxDBClient
from influxdb_client.rest import ApiException

matplotlib.use("Agg")
from matplotlib import pyplot as plt

RESULTS = Path(__file__).resolve().parents[1] / "results"
THING = "org.pzks:mannequin-01"
TARGET_MS = 250
RATE_TOLERANCE = 0.05


def read_sent():
    sent = {}
    with (RESULTS / "sent.csv").open(encoding="utf-8-sig", newline="") as file:
        for row in csv.DictReader(file):
            key = (int(row["seq"]), int(row["ts"]))
            if key in sent:
                raise ValueError(f"Дубль у sent.csv: {key}")
            sent[key] = int(row["rate"])
    if not sent:
        raise ValueError("Файл sent.csv не містить записів")
    return sent


def read_history(sent):
    stamps = [ts for _, ts in sent]
    start = min(stamps) * 1_000_000
    stop = (max(stamps) + 1) * 1_000_000
    query = f'''from(bucket: "twin")
      |> range(start: time(v: {start}), stop: time(v: {stop}))
      |> filter(fn: (r) => r._measurement == "twin_state" and r.thing == "{THING}")
      |> filter(fn: (r) => r._field == "seq" or r._field == "ts" or
                           r._field == "revision" or r._field == "sync_ms")
      |> map(fn: (r) => ({{r with time_ns: int(v: r._time)}}))
      |> keep(columns: ["time_ns", "_field", "_value"])'''
    points = defaultdict(dict)
    with InfluxDBClient(
        url="http://127.0.0.1:8086", org="pzks",
        token=os.getenv("INFLUX_TOKEN") or "dt-lab-token", timeout=120_000,
    ) as client:
        for record in client.query_api().query_stream(query):
            points[record.values["time_ns"]][record.get_field()] = record.get_value()

    history = {}
    for point in points.values():
        key = (point.get("seq"), point.get("ts"))
        if key in sent:
            if "revision" not in point or "sync_ms" not in point:
                raise ValueError(f"Неповний запис історика для відліку {key}")
            if not math.isfinite(point["sync_ms"]):
                raise ValueError(f"Некоректна затримка для відліку {key}")
            history[key] = point
    return history


def summarize(sent, history):
    steps = defaultdict(list)
    for key, rate in sent.items():
        steps[rate].append(key)

    rows = []
    for rate, keys in sorted(steps.items()):
        stamps = [ts for _, ts in keys]
        span = (max(stamps) - min(stamps)) / 1000
        actual = len(keys) / span if span else None
        delays = sorted(history[key]["sync_ms"] for key in keys if key in history)
        p50 = statistics.median(delays) if delays else None
        p95 = delays[math.ceil(0.95 * len(delays)) - 1] if delays else None
        reached = actual is not None and actual >= rate * (1 - RATE_TOLERANCE)
        rows.append({
            "rate": rate,
            "actual_rate": round(actual, 2) if actual is not None else None,
            "sent": len(keys),
            "received": len(delays),
            "loss_pct": round(100 * (len(keys) - len(delays)) / len(keys), 4),
            "p50_ms": round(p50, 2) if p50 is not None else None,
            "p95_ms": round(p95, 2) if p95 is not None else None,
            "target_reached": reached,
            "p95_ok": p95 <= TARGET_MS if p95 is not None else None,
        })

    revisions = {point["revision"] for point in history.values()}
    gaps = max(revisions) - min(revisions) + 1 - len(revisions) if revisions else None
    return rows, gaps


def save_graph(rows):
    fig, ax = plt.subplots(figsize=(8, 4.5), layout="constrained")
    measured = sorted(
        (row for row in rows if row["actual_rate"] and row["p95_ms"] is not None),
        key=lambda row: row["actual_rate"],
    )
    if measured:
        x = [row["actual_rate"] for row in measured]
        ax.plot(x, [row["p50_ms"] for row in measured], "o-", label="p50")
        ax.plot(x, [row["p95_ms"] for row in measured], "s-", label="p95")
        ax.set_xscale("log")
    else:
        ax.text(0.5, 0.5, "Немає зіставлених вимірювань",
                ha="center", transform=ax.transAxes)
    ax.axhline(TARGET_MS, color="tab:red", linestyle="--", label="Ціль NFR-01 (250 мс)")
    ax.set(xlabel="Фактична частота надсилання, повідомлень/с",
           ylabel="Затримка синхронізації, мс")
    ax.grid(alpha=0.3)
    ax.legend()
    fig.savefig(RESULTS / "latency_vs_load.png", dpi=160)
    plt.close(fig)


def markdown(rows, gaps):
    lines = [
        "## Навантажувальне тестування",
        "",
        "Locust генерував телеметрію для одного двійника. Частоту обчислено за журналом надсилання, "
        "а затримку — за полем `sync_ms` в історії InfluxDB. "
        "Ступінь вважається досягнутим, якщо фактична частота становить щонайменше 95% цільової.",
        "",
        "| Ціль, повід./с | Факт, повід./с | Надіслано | В історії | Втрати, % | p50, мс | p95, мс | Цільову частоту досягнуто |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |",
    ]
    for row in rows:
        values = [
            row["rate"], row["actual_rate"], row["sent"], row["received"],
            row["loss_pct"], row["p50_ms"], row["p95_ms"],
            "так" if row["target_reached"] else "ні",
        ]
        lines.append("| " + " | ".join("—" if value is None else str(value) for value in values) + " |")
    missing = sum(row["sent"] - row["received"] for row in rows)
    gap_text = str(gaps) if gaps is not None else "немає даних"
    lines += [
        "",
        f"Без відповідника в історії залишилося {missing} відліків. "
        f"Кількість пропусків між отриманими ревізіями Ditto — {gap_text}. "
        "Пропущені ревізії вказують на неповноту шляху спостереження. "
        "Цей підрахунок охоплює лише інтервал між першою й останньою зіставленими ревізіями.",
        "",
        "![Залежність затримки синхронізації від навантаження](../results/latency_vs_load.png)",
        "",
        "## Висновок щодо масштабованості",
        "",
    ]
    passed = [row for row in rows if row["target_reached"] and row["p95_ok"]]
    if passed:
        best = max(passed, key=lambda row: row["rate"])
        lines.append(
            f"Найвищий перевірений ступінь із p95 ≤ {TARGET_MS} мс — {best['rate']} повід./с "
            f"(фактично {best['actual_rate']} повід./с, p95 = {best['p95_ms']} мс, "
            f"частка відліків без відповідника в історії — {best['loss_pct']}%). "
            "Це результат для отриманих відліків і тривалості цього прогону."
        )
    else:
        lines.append("Серед досягнутих ступенів немає підтвердженого результату p95 ≤ 250 мс.")
    lines += [
        "",
        "За моделлю черги (5) середній час перебування повідомлення в системі "
        "W = 1/(μ − λ) зростає, коли інтенсивність надходження λ наближається до "
        "інтенсивності обслуговування μ. Для одного двійника послідовне застосування "
        "оновлень обмежує його пропускну здатність.",
        "",
        "Для більшої кількості об’єктів різні двійники можна розподілити між вузлами "
        "кластера Ditto. Для вищої частоти одного об’єкта варто скорочувати вартість "
        "обробки окремого оновлення або агрегувати часті відліки на шлюзі, зберігаючи "
        "детальну телеметрію окремо від поточного стану двійника.",
        "",
    ]
    return "\n".join(lines)


def main():
    try:
        sent = read_sent()
        rows, gaps = summarize(sent, read_history(sent))
        with (RESULTS / "load.csv").open("w", encoding="utf-8", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
        save_graph(rows)
        report = markdown(rows, gaps)
        (RESULTS / "load.md").write_text(report, encoding="utf-8")
    except (ApiException, OSError, ValueError, KeyError) as error:
        raise SystemExit(f"Помилка аналізу навантаження: {error}") from error
    print(report)


if __name__ == "__main__":
    main()

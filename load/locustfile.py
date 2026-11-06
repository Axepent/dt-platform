"""Ступінчасте MQTT-навантаження на двійник манекена."""

import csv
import itertools
import json
import os
import time
from pathlib import Path

from locust import LoadTestShape, User, constant_throughput, events, task
from locust.exception import StopUser
from gevent.event import Event
import paho.mqtt.client as mqtt

TOPIC = "pzks/mannequin-01/telemetry"
RATE = 5
STEPS = (1, 2, 5, 10, 20, 40, 80)
STEP_TIME = int(os.getenv("STEP_TIME", "60"))
if STEP_TIME <= 0:
    raise ValueError("STEP_TIME має бути додатним цілим числом")

SENT_PATH = Path(__file__).resolve().parents[1] / "results" / "sent.csv"
SEQ = itertools.count(1_000_000)
TELEMETRY = {
    "sh": 25.0, "el": 40.0, "hip": 15.0, "kn": 30.0, "hd": 5.0, "tor": 10.0,
    "i": 0.8, "t": 28.0, "v": 11.9, "lim": False, "est": False,
}


@events.test_start.add_listener
def open_log(environment, **kwargs):
    SENT_PATH.parent.mkdir(parents=True, exist_ok=True)
    environment.sent_file = SENT_PATH.open("w", encoding="utf-8", newline="")
    environment.sent_log = csv.writer(environment.sent_file)
    environment.sent_log.writerow(("seq", "ts", "rate"))


@events.test_stop.add_listener
def close_log(environment, **kwargs):
    environment.sent_file.close()


class Gateway(User):
    wait_time = constant_throughput(RATE)

    def on_start(self):
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        connack = Event()
        connection_error = None

        def on_connect(client, userdata, flags, reason_code, properties):
            nonlocal connection_error
            if reason_code.is_failure:
                connection_error = ConnectionError(str(reason_code))
            connack.set()

        self.client.on_connect = on_connect
        start = time.perf_counter()
        try:
            self.client.connect("127.0.0.1", 1883)
            self.client.loop_start()
            if not connack.wait(timeout=5):
                raise TimeoutError("Немає CONNACK")
            if connection_error is not None:
                raise connection_error
        except (OSError, RuntimeError) as error:
            self.environment.events.request.fire(
                request_type="MQTT", name="connect",
                response_time=(time.perf_counter() - start) * 1000,
                response_length=0, exception=error,
            )
            raise StopUser() from error

    def on_stop(self):
        self.client.disconnect()
        self.client.loop_stop()

    @task
    def publish(self):
        seq = next(SEQ)
        ts = time.time_ns() // 1_000_000
        rate = self.environment.shape_class.target_rate
        payload = json.dumps({"seq": seq, "ts": ts, **TELEMETRY}).encode("utf-8")
        start = time.perf_counter()
        error = None
        try:
            info = self.client.publish(TOPIC, payload, qos=1)
            if info.rc != mqtt.MQTT_ERR_SUCCESS:
                raise RuntimeError(f"Помилка MQTT publish: {info.rc}")
            self.environment.sent_log.writerow((seq, ts, rate))
            info.wait_for_publish(timeout=5)
            if not info.is_published():
                raise TimeoutError("Немає PUBACK")
        except (OSError, RuntimeError, ValueError) as exc:
            error = exc
        self.environment.events.request.fire(
            request_type="MQTT", name="publish",
            response_time=(time.perf_counter() - start) * 1000,
            response_length=0, exception=error,
        )


class Steps(LoadTestShape):
    target_rate = STEPS[0] * RATE

    def tick(self):
        step = int(self.get_run_time() // STEP_TIME)
        if step >= len(STEPS):
            return None
        self.target_rate = STEPS[step] * RATE
        return STEPS[step], 100

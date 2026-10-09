"""Розрахункова модель маршруту від сформованого відліку до кадру інтерфейсу.

Python 3.9+, без сторонніх бібліотек. Числа є проєктними припущеннями,
а не вимірюваннями. Модель не оцінює p95, черги та пропускну здатність.
"""

TARGET_SYNC = 250  # NFR-01, мс; експериментальний критерій стосується p95
TARGET_E2E = 500   # NFR-02, мс; експериментальний критерій стосується p95
POLL_INTERVAL = 200  # мс, проєктний варіант періодичного читання API
UI_TRANSFER_RENDER = 20  # мс, передавання, розбір і відображення
PUSH_DELIVERY = 10  # мс, підготовка та доставка push до оброблення UI

BASE = {
    'Датчик -> DataCollection': 15,
    'DataCollection -> MQTT-брокер': 25,
    'MQTT-брокер -> стан у API': 40,
    'Стан у API -> UserApplication': POLL_INTERVAL / 2 + UI_TRANSFER_RENDER,
}
SYNC = tuple(BASE)[:3]
UI_STAGE = tuple(BASE)[-1]
PARALLEL = {
    'Запис історії після валідації': 60,
    'Журналювання події / помилки': 20,
}
HYPOTHESIS = {**BASE, UI_STAGE: PUSH_DELIVERY + UI_TRANSFER_RENDER}


def totals(route):
    if any(value < 0 for value in route.values()):
        raise ValueError('Затримки не можуть бути від’ємними')
    return sum(route[name] for name in SYNC), sum(route.values())


def comparison(value, target):
    return 'у межах цілі моделі' if value <= target else 'перевищує ціль моделі'


def report(title, route):
    sync, total = totals(route)
    print(title)
    for name, value in route.items():
        share = value / total * 100 if total else 0
        print(f'  {name}: {value:.1f} мс ({share:.1f} %)')
    print(f'  До API: {sync:.1f} / {TARGET_SYNC} мс; {comparison(sync, TARGET_SYNC)}')
    print(f'  Наскрізна: {total:.1f} / {TARGET_E2E} мс; {comparison(total, TARGET_E2E)}')
    print()
    return total


def main():
    print('ПРОЄКТНА МОДЕЛЬ: не вимірювання і не підтвердження p95 NFR.\n')
    base = report('Базова конфігурація: опитування API кожні 200 мс', BASE)
    hyp = report('Гіпотеза Г-01: push через WebSocket', HYPOTHESIS)
    largest = max(BASE, key=BASE.get)
    print(f'Найбільша ділянка: {largest} ({BASE[largest]:.1f} мс).')
    print(f'Очікуване зменшення: {base - hyp:.1f} мс; {(1 - hyp / base) * 100:.1f} %.')
    print('\nПаралельні гілки (НЕ додаються до маршруту):')
    for name, value in PARALLEL.items():
        print(f'  {name}: {value:.1f} мс')
    print('\nЧутливість до інтервалу опитування API:')
    for period in (50, 100, 200, 500, 1000):
        route = {**BASE, UI_STAGE: period / 2 + UI_TRANSFER_RENDER}
        sync, total = totals(route)
        print(f'  T={period:4d} мс: до API={sync:.1f}; наскрізна={total:.1f} мс; '
              f'{comparison(total, TARGET_E2E)}')
    print('\nСереднє очікування T/2 припускає рівномірну фазу відліків відносно опитування.')
    print('Перевірка Г-01: виміряти медіану наскрізної затримки; очікується зниження >=30 %.')
    print('Окремо перевірити p95 <=250 мс до API і p95 <=500 мс до кадру та пропуски ID.')


if __name__ == '__main__':
    main()

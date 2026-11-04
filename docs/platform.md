# Розгортання платформи цифрового двійника

## Перевірка API

```powershell
$api = 'http://127.0.0.1:8080/api/2'
$thingId = 'org.pzks:test-1'
$body = '{"attributes":{"purpose":"\u043f\u0435\u0440\u0435\u0432\u0456\u0440\u043a\u0430"}}'

$body | curl.exe -i -u ditto:ditto -X PUT `
    -H 'Content-Type: application/json' --data-binary '@-' `
    "$api/things/$thingId"

curl.exe -i -u ditto:ditto "$api/things/$thingId"
curl.exe -i -u ditto:ditto "$api/policies/$thingId"
```

Фактичні відповіді Ditto на створення двійника, читання двійника та читання політики доступу.

```text
HTTP/1.1 201 CreatedServer: nginx
Date: Wed, 04 Nov 2026 12:58:38 GMT
Content-Type: application/json
Content-Length: 104
Connection: keep-alive
Location: http://127.0.0.1:8080/api/2/things/org.pzks:test-1
correlation-id: de0a50d6-ab05-4770-8061-6254842b92d2
ditto-originator: nginx:ditto
entity-revision: 1
response-required: false
etag: "rev:1"

{"thingId":"org.pzks:test-1","policyId":"org.pzks:test-1","attributes":{"purpose":"перевірка"}}

HTTP/1.1 200 OK
Server: nginx
Date: Wed, 04 Nov 2026 12:58:38 GMT
Content-Type: application/json
Content-Length: 104
Connection: keep-alive
correlation-id: a33f7693-613e-4fe1-8cdb-1a385bc10fea
ditto-originator: nginx:ditto
entity-revision: 1
response-required: false
etag: "rev:1"

{"thingId":"org.pzks:test-1","policyId":"org.pzks:test-1","attributes":{"purpose":"перевірка"}}

HTTP/1.1 200 OK
Server: nginx
Date: Wed, 04 Nov 2026 12:58:39 GMT
Content-Type: application/json
Content-Length: 303
Connection: keep-alive
correlation-id: e80912e3-1f67-48aa-a304-062e4a4dee0f
ditto-originator: nginx:ditto
entity-revision: 1
response-required: false
etag: "rev:1"

{"policyId":"org.pzks:test-1","imports":{},"entries":{"DEFAULT":{"subjects":{"nginx:ditto":{"type":"generated"}},"resources":{"thing:/":{"grant":["READ","WRITE"],"revoke":[]},"policy:/":{"grant":["READ","WRITE"],"revoke":[]},"message:/":{"grant":["READ","WRITE"],"revoke":[]}},"importable":"implicit"}}}
```


## Структура двійника

Модель роботизованого художнього манекена охоплює шість керованих осей і 11 сигналів телеметрії. Запропоновані нижче назви атрибутів і властивостей задають структуру майбутньої моделі в Eclipse Ditto.

| Елемент | Вид | Відповідник у Ditto | Джерело |
|---|---|---|---|
| Тип об’єкта — роботизований художній манекен | Паспортна властивість | `attributes/assetType` | ЛР1, [опис об’єкта](requirements.md) |
| Кількість модельованих осей — 6 | Паспортна властивість | `attributes/axisCount` | ЛР1, [межі моделі](requirements.md) |
| Кут згинання плеча | Властивість стану | `features/pose/properties/shoulderAngle` | S-01 |
| Кут згинання ліктя | Властивість стану | `features/pose/properties/elbowAngle` | S-02 |
| Кут згинання кульшового шарніра | Властивість стану | `features/pose/properties/hipAngle` | S-03 |
| Кут згинання коліна | Властивість стану | `features/pose/properties/kneeAngle` | S-04 |
| Кут повороту голови | Властивість стану | `features/pose/properties/headAngle` | S-05 |
| Кут нахилу тулуба | Властивість стану | `features/pose/properties/torsoAngle` | S-06 |
| Струм привода D-01 | Властивість стану | `features/drive/properties/current` | S-07 |
| Температура привода D-01 | Властивість стану | `features/drive/properties/temperature` | S-08 |
| Напруга живлення | Властивість стану | `features/power/properties/voltage` | S-09 |
| Стан кінцевого вимикача | Властивість стану | `features/safety/properties/limitSwitchActive` | S-10 |
| Стан входу аварійного зупинення | Властивість стану | `features/safety/properties/emergencyStopActive` | S-11 |
| Задати цільові кути | Функція | Повідомлення `set-target-pose` у `inbox` двійника | ЛР1, [FR-03](requirements.md) |
| Керується контролером | Зв’язок `controlledBy` | `attributes/controllerId` | ЛР1, [опис керування](requirements.md) |

Атрибут `controllerId` містить `thingId` двійника контролера, наприклад `org.pzks:controller-01`. Семантику зв’язку `controlledBy` буде визначено в онтології на занятті 2. Повідомлення `set-target-pose` передає цільові кути. Фактичні кути з телеметрії зберігаються у властивостях блока `pose`.

## Порівняння платформ

Порівняно Eclipse Ditto, Azure Digital Twins і AWS IoT TwinMaker для навчального стенда роботизованого манекена. Оцінки від 1 до 5 характеризують придатність до цього сценарію. 1 означає слабку відповідність критерію, 3 — часткову, 5 — повну. Проміжні оцінки позначають відповідність із меншими або більшими обмеженнями.

### Ваги критеріїв

Ваги задано за вимогами стенда до виставлення оцінок. Локальне розгортання враховано як пріоритет порівняння, щоб показати компроміси між усіма трьома варіантами.

| Критерій | Вага | Підстава |
|---|---:|---|
| Локальне розгортання | 0,25 | Стенд і джерело телеметрії працюють на навчальному ПК. |
| Відкритість | 0,20 | Потрібно відтворювати стенд і переносити модель між реалізаціями. |
| Вартість володіння | 0,20 | Багаторазові експерименти мають вкладатися в навчальний бюджет. |
| Масштабованість | 0,15 | У ЛР1 передбачено випробування з 1 і 10 емуляторами. |
| Підтримка протоколів | 0,15 | У ЛР1 обрано MQTT для обміну з емулятором. Для читання стану потрібен HTTP API. |
| Зрілість спільноти | 0,05 | Документація й публічні канали підтримки полегшують відтворення стенда. |
| **Сума** | **1,00** | |

### Оцінки та обґрунтування

| Критерій | Eclipse Ditto | Azure Digital Twins | AWS IoT TwinMaker |
|---|---|---|---|
| Локальне розгортання | **5** — офіційний Docker Compose підходить для локального стенда. [Запуск Ditto][ditto-run] | **1** — екземпляр створюється як ресурс Azure. [Огляд служби][azure-overview] | **1** — робочий простір створюється у хмарній службі AWS. [Огляд служби][aws-overview] |
| Відкритість | **5** — відкритий код під EPL-2.0 та підтримка W3C WoT Thing Model. [Код Ditto][ditto-code], [WoT][ditto-wot] | **3** — специфікація DTDL відкрита, реалізація платформи є керованою службою Azure. [Моделі DTDL][azure-models] | **2** — типи компонентів описуються в JSON за схемою API TwinMaker. Це дає машинозчитуваний опис із прив’язкою до моделі служби. [ComponentType][aws-component] |
| Вартість володіння | **4** — для наявного ПК немає плати за виклики платформи. Потрібно виділити ресурси та самостійно супроводжувати стенд. [Ліцензія][ditto-code], [Розгортання][ditto-run] | **3** — витрати залежать від операцій, повідомлень і запитів. У повній схемі слід також враховувати служби інтеграції. [Тарифи Azure][azure-price], [Інтеграція][azure-ingest] | **3** — вартість залежить від тарифного плану й використання. Окремо враховуються підключені служби зберігання та обробки. [Тарифи AWS][aws-price] |
| Масштабованість | **4** — передбачено кластерне розгортання, ресурси й конфігурацію якого визначає команда. [Розгортання Ditto][ditto-run] | **5** — керована служба має документовані квоти на граф і операції. Для цього критерію оцінено можливість нарощування без адміністрування власного кластера. [Ліміти Azure][azure-limits] | **4** — служба керована, але для наскрізного масштабування потрібно враховувати квоти робочого простору та пропускну здатність джерел даних. [Квоти AWS][aws-quotas], [Архітектура][aws-overview] |
| Підтримка протоколів | **5** — MQTT можна підключити через Ditto Connectivity, а стан читати через HTTP API. [Документація Ditto][ditto-docs] | **3** — є HTTP API, а телеметрія з IoT Hub потребує окремої інтеграції через Azure Functions. [Передавання телеметрії][azure-ingest] | **2** — є API та з’єднувачі до джерел даних. Для наявного MQTT-потоку потрібен проміжний шар, який передасть дані до підключеного джерела. [Архітектура][aws-overview], [API TwinMaker][aws-component] |
| Зрілість спільноти | **3** — доступні публічний репозиторій, випуски та обговорення проблем. [Репозиторій Ditto][ditto-code] | **4** — документація містить покрокові приклади, також є публічний канал підтримки Microsoft Q&A. [Документація Azure][azure-overview], [Microsoft Q&A][azure-community] | **3** — доступні посібник, приклади та публічний канал запитань AWS re:Post. [Посібник AWS][aws-overview], [AWS re:Post][aws-community] |

Зведену оцінку обчислено за формулою `S = Σ(wᵢ × sᵢ) / Σwᵢ`. За суми ваг 1,00 достатньо скласти добутки.

| Платформа | Розрахунок | S |
|---|---|---:|
| Eclipse Ditto | 0,25 × 5 + 0,20 × 5 + 0,20 × 4 + 0,15 × 4 + 0,15 × 5 + 0,05 × 3 | **4,55** |
| Azure Digital Twins | 0,25 × 1 + 0,20 × 3 + 0,20 × 3 + 0,15 × 5 + 0,15 × 3 + 0,05 × 4 | **2,85** |
| AWS IoT TwinMaker | 0,25 × 1 + 0,20 × 2 + 0,20 × 3 + 0,15 × 4 + 0,15 × 2 + 0,05 × 3 | **2,30** |

Eclipse Ditto отримав найвищу оцінку для локального стенда завдяки власному розгортанню, відкритому коду та підтримці MQTT. Бали за масштабованість характеризують можливості архітектури. Фактичну пропускну здатність стенда буде визначено навантажувальним тестом. Рішення зафіксовано в [ADR-0004](adr/0004-vybir-platformy.md).

[ditto-run]: https://eclipse.dev/ditto/installation-running.html
[ditto-code]: https://github.com/eclipse-ditto/ditto
[ditto-docs]: https://eclipse.dev/ditto/
[ditto-wot]: https://eclipse.dev/ditto/basic-wot-integration.html
[azure-overview]: https://learn.microsoft.com/en-us/azure/digital-twins/overview
[azure-models]: https://learn.microsoft.com/en-us/azure/digital-twins/concepts-models
[azure-price]: https://azure.microsoft.com/en-us/pricing/details/digital-twins/
[azure-ingest]: https://learn.microsoft.com/en-us/azure/digital-twins/how-to-ingest-iot-hub-data
[azure-limits]: https://learn.microsoft.com/en-us/azure/digital-twins/reference-service-limits
[azure-community]: https://learn.microsoft.com/en-us/answers/
[aws-overview]: https://docs.aws.amazon.com/iot-twinmaker/latest/guide/what-is-twinmaker.html
[aws-component]: https://docs.aws.amazon.com/iot-twinmaker/latest/apireference/API_CreateComponentType.html
[aws-price]: https://aws.amazon.com/iot-twinmaker/pricing/
[aws-quotas]: https://docs.aws.amazon.com/general/latest/gr/iot-twinmaker.html
[aws-community]: https://repost.aws/

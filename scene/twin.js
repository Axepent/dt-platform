const get = id => document.getElementById(id);

export async function bindTwin(station) {
  const response = await fetch('binding.json');
  if (!response.ok) throw new Error(`binding.json: HTTP ${response.status}`);
  const config = await response.json();
  get('thing').textContent = config.thing;
  get('bound').textContent = `0 з ${config.bindings.length}`;
  const cells = config.bindings.map(binding => {
    const row = document.createElement('tr');
    const label = document.createElement('th');
    label.scope = 'row';
    label.textContent = binding.title;
    const value = document.createElement('td');
    value.textContent = '—';
    row.append(label, value);
    get('vals').append(row);
    return value;
  });

  let revision = -1;
  let sourceTs = 0;
  const bound = new Set();

  function showAge() {
    if (!sourceTs) return;
    const age = Math.max(0, (Date.now() - sourceTs) / 1000);
    get('age').textContent = `${age.toFixed(1)} с`;
    get('age').classList.toggle('stale', age >= 2);
  }

  function apply(thing, fallbackRevision) {
    if (thing.thingId && thing.thingId !== config.thing) return;
    const incoming = thing._revision ?? fallbackRevision;
    if (Number.isFinite(incoming) && incoming < revision) return;
    if (Number.isFinite(incoming)) {
      revision = incoming;
      get('rev').textContent = revision;
    }
    const features = thing.features ?? {};
    config.bindings.forEach((binding, i) => {
      const value = features[binding.feature]?.properties?.[binding.property];
      if (!Number.isFinite(value)) return;
      cells[i].textContent = `${value.toFixed(2)}${binding.unit}`;
      if (station.apply(config.unit, binding, value)) bound.add(binding.node);
    });
    get('bound').textContent = `${bound.size} з ${config.bindings.length}`;
    const timestamp = features.sync?.properties?.ts;
    if (Number.isFinite(timestamp)) sourceTs = Math.max(timestamp, sourceTs);
    showAge();
  }

  const api = '/api/2/things';
  const fields = 'thingId,features,_revision';
  const streamQuery = new URLSearchParams({ ids: config.thing, fields });
  const events = new EventSource(`${api}?${streamQuery}`);
  const status = get('status');
  let eventCount = 0;

  async function refresh() {
    const startedAt = eventCount;
    try {
      const query = new URLSearchParams({ fields });
      const reply = await fetch(`${api}/${encodeURIComponent(config.thing)}?${query}`, {
        cache: 'no-store',
      });
      if (!reply.ok) throw new Error(`HTTP ${reply.status}`);
      const thing = await reply.json();
      const header = reply.headers.get('entity-revision');
      const fallback = header === null ? undefined : Number(header);
      if (Number.isFinite(thing._revision ?? fallback) || startedAt === eventCount) {
        apply(thing, fallback);
      }
    } catch (error) {
      if (eventCount === startedAt) status.textContent = `Початковий стан: ${error.message}`;
    }
  }

  events.onmessage = event => {
    try {
      const thing = JSON.parse(event.data);
      if (thing.thingId && thing.thingId !== config.thing) return;
      eventCount++;
      apply(thing);
      status.textContent = 'SSE підключено';
    } catch (error) {
      console.error('Ditto SSE', error);
      status.textContent = 'Помилка оброблення події Ditto';
    }
  };
  events.onopen = () => {
    status.textContent = 'SSE підключено';
    void refresh();
  };
  events.onerror = () => {
    status.textContent = events.readyState === EventSource.CLOSED
      ? 'SSE недоступний' : 'SSE: повторне підключення…';
  };

  void refresh();
  setInterval(showAge, 250);
}

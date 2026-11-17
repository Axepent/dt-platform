import * as THREE from 'three';
import { PORT, PROFILES, T_SN, walk } from './shared.js';

export function connectSession({ scene, camera, renderer, hooks, params }) {
  const name = params.get('name').trim().slice(0, 20);
  const requested = params.get('profile');
  const profile = Object.hasOwn(PROFILES, requested) ? requested : 'lan';
  const { m, jitter } = PROFILES[profile];
  const mode = params.get('mode') === 'extrap' ? 'extrap' : 'interp';
  const delay = mode === 'interp' ? (m + 1) * T_SN + jitter : 0;
  const seconds = Number(params.get('measure'));
  const measure = Number.isFinite(seconds) && seconds > 0;
  const query = new URLSearchParams({ name, profile });
  const socket = new WebSocket(`ws://${location.hostname}:${PORT}/?${query}`);
  const send = message => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'Спільна сцена');
  panel.style.cssText = 'margin-top:12px;padding-top:9px;border-top:1px solid #dce6e8';
  const status = document.createElement('div');
  const participants = document.createElement('div');
  participants.style.cssText = 'margin-top:4px;font-size:12px;overflow-wrap:anywhere';
  const traffic = document.createElement('div');
  traffic.style.cssText = participants.style.cssText;
  const hint = document.createElement('div');
  hint.style.cssText = 'margin-top:6px;font-size:12px';
  hint.textContent = 'Подвійне клацання по сцені — додати позначку';
  const marksList = document.createElement('ul');
  marksList.style.cssText = 'margin:6px 0 0;padding-left:19px;max-height:18vh;overflow:auto;overflow-wrap:anywhere';
  panel.append(status, participants, traffic, hint, marksList);
  const resultText = document.createElement('div');
  if (measure) {
    resultText.style.cssText = 'margin-top:8px;font-size:12px';
    resultText.textContent = 'Замір: очікування бота…';
    panel.append(resultText);
  }
  document.getElementById('hud').append(panel);
  const prefix = `${name} (${profile}, ${mode})`;
  status.textContent = `${prefix} · підключення…`;
  for (const link of document.querySelectorAll('nav a')) {
    const url = new URL(link.href);
    url.searchParams.set('name', name);
    url.searchParams.set('profile', profile);
    if (mode === 'extrap') url.searchParams.set('mode', mode);
    link.href = url.href;
  }

  const avatars = new Map();
  const avatarRoot = new THREE.Group();
  const marksRoot = new THREE.Group();
  const headGeometry = new THREE.SphereGeometry(0.35, 16, 12);
  const noseGeometry = new THREE.ConeGeometry(0.15, 0.5, 12);
  const markerGeometry = new THREE.ConeGeometry(0.15, 0.6, 12);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xd32f2f });
  scene.add(avatarRoot, marksRoot);

  function avatar(who) {
    if (avatars.has(who)) return avatars.get(who);
    const hash = Array.from(who).reduce((value, ch) =>
      (Math.imul(value, 31) + ch.codePointAt(0)) >>> 0, 0);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL((hash * 0.61803398875) % 1, 0.72, 0.51),
    });
    const head = new THREE.Mesh(headGeometry, material);
    const nose = new THREE.Mesh(noseGeometry, material);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -0.45;
    head.name = who;
    head.add(nose);
    avatarRoot.add(head);
    avatars.set(who, head);
    return head;
  }

  let initialMarkIds;
  function showMarks(list) {
    initialMarkIds ??= new Set(list.map(mark => mark.id));
    marksRoot.clear();
    marksList.replaceChildren();
    for (const mark of list) {
      const cone = new THREE.Mesh(markerGeometry, markerMaterial);
      cone.rotation.x = Math.PI;
      cone.position.fromArray(mark.p);
      cone.position.y += 0.3;
      marksRoot.add(cone);
      const row = document.createElement('li');
      row.textContent = `${mark.author}: ${mark.text} `;
      if (mark.author === name && !initialMarkIds.has(mark.id)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '×';
        button.setAttribute('aria-label', 'Видалити позначку');
        button.addEventListener('click', () => send({ type: 'unmark', id: mark.id }));
        row.append(button);
      }
      marksList.append(row);
    }
  }

  const snapshots = [];
  const offsets = [];
  const encoder = new TextEncoder();
  let poseBytes = 0;
  let poseCount = 0;
  let previousParticipants;
  const rtt = [];
  const delays = [];
  let frames = 0;
  let starvedFrames = 0;
  let maxOffset = 0;
  let startedAt;
  let finished = false;
  let interrupted = false;

  function onVisibilityChange() {
    if (document.hidden && startedAt !== undefined && !finished) interrupted = true;
  }
  if (measure) document.addEventListener('visibilitychange', onVisibilityChange);

  function percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return Number(sorted[Math.ceil(p * sorted.length) - 1].toFixed(3));
  }

  function sampleBot(now, starved) {
    if (!measure || finished) return;
    const bot = avatars.get('bot');
    if (!bot) {
      if (startedAt !== undefined) interrupted = true;
      resultText.textContent = 'Замір: очікування бота…';
      return;
    }
    if (document.hidden) return;
    startedAt ??= performance.now();
    if (interrupted) {
      finished = true;
      resultText.textContent = 'Замір перервано. Перезавантажте сторінку й залиште її видимою.';
      return;
    }
    if (performance.now() - startedAt >= seconds * 1000) {
      const report = {
        type: 'report', profile, mode, d_int_ms: delay,
        rtt_p50_ms: percentile(rtt, 0.5),
        delay_p50_ms: percentile(delays, 0.5),
        delay_p95_ms: percentile(delays, 0.95),
        off_max_m: Number(maxOffset.toFixed(4)),
        starved_pct: Number((100 * starvedFrames / frames).toFixed(1)),
        frames,
        delay_samples: delays.length,
        rtt_samples: rtt.length,
      };
      send(report);
      finished = true;
      resultText.textContent = `Звіт надіслано: results/net-${profile}-${mode}.json`;
      return;
    }

    // Recover display latency by comparing the displayed bot with its known trajectory.
    let bestLag = 0;
    let minSquared = Infinity;
    for (let lag = 0; lag <= 600; lag += 2) {
      const [x, y, z] = walk(now - lag).p;
      const squared = (bot.position.x - x) ** 2
        + (bot.position.y - y) ** 2 + (bot.position.z - z) ** 2;
      if (squared < minSquared) {
        minSquared = squared;
        bestLag = lag;
      }
    }
    frames++;
    if (starved) starvedFrames++;
    maxOffset = Math.max(maxOffset, Math.sqrt(minSquared));
    if (walk(now).steady) delays.push(bestLag);
    const elapsed = Math.floor((performance.now() - startedAt) / 1000);
    const label = `Замір: ${elapsed} / ${seconds} с`;
    if (resultText.textContent !== label) resultText.textContent = label;
  }
  socket.onmessage = event => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === 'marks') showMarks(message.marks);
    if (message.type === 'pong' && measure && startedAt !== undefined && !finished) {
      rtt.push(Date.now() - message.t);
    }
    if (message.type !== 'snap') return;
    if (snapshots.length && message.t <= snapshots.at(-1).t) return;
    snapshots.push(message);
    const receivedAt = performance.now();
    offsets.push({ receivedAt, difference: message.t - Date.now() });
    if (snapshots.length > 40) snapshots.shift();
    discardOldOffsets(receivedAt);

    const names = Object.keys(message.avatars);
    const encodedNames = names.join(', ');
    if (encodedNames !== previousParticipants) {
      participants.textContent = encodedNames ? `Віддалені учасники: ${encodedNames}` : 'Очікування учасників…';
      previousParticipants = encodedNames;
    }
    for (const who of names) {
      poseBytes += encoder.encode(JSON.stringify({ [who]: message.avatars[who] })).byteLength - 2;
      poseCount++;
    }
    if (poseCount) {
      const text = `Середній запис пози s ≈ ${(poseBytes / poseCount).toFixed(1)} Б`;
      if (traffic.textContent !== text) traffic.textContent = text;
    }
    for (const [who, head] of avatars) {
      if (Object.hasOwn(message.avatars, who)) continue;
      avatarRoot.remove(head);
      head.material.dispose();
      avatars.delete(who);
    }
  };

  const prevPosition = new THREE.Vector3();
  const nextPosition = new THREE.Vector3();
  const prevRotation = new THREE.Quaternion();
  const nextRotation = new THREE.Quaternion();
  function discardOldOffsets(now) {
    while (offsets.length && now - offsets[0].receivedAt > 5000) offsets.shift();
  }

  function updateAvatars() {
    discardOldOffsets(performance.now());
    if (!offsets.length) return;
    const now = Date.now();
    const serverTime = now + Math.max(...offsets.map(sample => sample.difference));
    const displayTime = serverTime - delay;
    const newest = snapshots.at(-1);
    const nextIndex = snapshots.findIndex(snapshot => snapshot.t > displayTime);
    const starved = nextIndex < 0;
    const b = starved ? newest : snapshots[nextIndex];
    const a = snapshots[Math.max(0, (starved ? snapshots.length - 1 : nextIndex) - 1)];
    const span = b.t - a.t;
    const upper = mode === 'extrap' && span > 0 ? 1 + 250 / span : 1;
    const fraction = span > 0
      ? THREE.MathUtils.clamp((displayTime - a.t) / span, 0, upper) : 1;
    for (const [who, current] of Object.entries(newest.avatars)) {
      const to = Object.hasOwn(b.avatars, who) ? b.avatars[who] : current;
      const from = Object.hasOwn(a.avatars, who) ? a.avatars[who] : to;
      const object = avatar(who);
      object.position.lerpVectors(prevPosition.fromArray(from.p), nextPosition.fromArray(to.p), fraction);
      object.quaternion.slerpQuaternions(prevRotation.fromArray(from.q),
        nextRotation.fromArray(to.q), Math.min(fraction, 1));
    }
    sampleBot(now, starved);
  }
  hooks.push(updateAvatars);

  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function createMark(event) {
    if (socket.readyState !== WebSocket.OPEN) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
      1 - (event.clientY - rect.top) / rect.height * 2);
    ray.setFromCamera(pointer, camera);
    const meshes = [];
    for (const object of scene.children) {
      if (object === avatarRoot || object === marksRoot) continue;
      object.traverseVisible(item => { if (item.isMesh) meshes.push(item); });
    }
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) return;
    const text = window.prompt('Текст позначки', 'Перевірити манекен')?.trim();
    if (text) send({ type: 'mark', text: text.slice(0, 80), p: hit.point.toArray() });
  }
  renderer.domElement.addEventListener('dblclick', createMark);

  const sendPose = () => send({
    type: 'pose',
    p: camera.position.toArray(),
    q: camera.quaternion.toArray(),
  });
  const poseTimer = setInterval(sendPose, T_SN);
  const pingTimer = measure ? setInterval(() => send({ type: 'ping', t: Date.now() }), 1000) : null;
  socket.onopen = () => {
    status.textContent = `${prefix} · WebSocket підключено`;
    sendPose();
  };
  socket.onerror = () => { status.textContent = `${prefix} · помилка WebSocket`; };
  let closed = false;
  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(poseTimer);
    clearInterval(pingTimer);
    if (measure) document.removeEventListener('visibilitychange', onVisibilityChange);
    renderer.domElement.removeEventListener('dblclick', createMark);
    hooks.splice(hooks.indexOf(updateAvatars), 1);
    for (const head of avatars.values()) head.material.dispose();
    scene.remove(avatarRoot, marksRoot);
    for (const resource of [headGeometry, noseGeometry, markerGeometry, markerMaterial]) resource.dispose();
  }
  socket.onclose = event => {
    status.textContent = event.code === 1008
      ? `${prefix} · ім’я вже використовується`
      : `${prefix} · сеанс від’єднано`;
    participants.textContent = '';
    marksList.replaceChildren();
    cleanup();
  };
  return () => {
    cleanup();
    socket.close();
  };
}

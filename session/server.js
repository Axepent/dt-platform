import { mkdirSync, writeFileSync } from 'node:fs';
import { WebSocket, WebSocketServer } from 'ws';
import { PORT, T_SN, PROFILES } from '../scene/shared.js';

const host = '127.0.0.1';
const server = new WebSocketServer({ host, port: PORT, maxPayload: 16 * 1024 });
const participants = new Map();
const marks = new Map();
const resultsDirectory = new URL('../results/', import.meta.url);
let nextMarkId = 1;
let sentBytes = 0;

// Two links per participant model independent delays in either direction.
function makeLink({ rtt, jitter, loss }) {
  const queue = [];
  let timer;

  function flush() {
    timer = undefined;
    while (queue.length && queue[0].at <= performance.now()) {
      queue.shift().deliver();
    }
    if (queue.length) schedule();
  }

  function schedule() {
    timer = setTimeout(flush, Math.max(0, Math.ceil(queue[0].at - performance.now())));
  }

  return {
    send(deliver) {
      const extraRtt = Math.random() < loss ? rtt : 0;
      const arrival = performance.now() + rtt / 2 + Math.random() * jitter + extraRtt;
      const at = Math.max(arrival, queue.at(-1)?.at ?? arrival);
      queue.push({ at, deliver });
      if (timer === undefined) schedule();
    },
    close() {
      clearTimeout(timer);
      timer = undefined;
      queue.length = 0;
    },
  };
}

function validPosition(value) {
  return Array.isArray(value) && value.length === 3
    && value.every(n => Number.isFinite(n) && Math.abs(n) <= 1100);
}

function post(client, message) {
  const data = JSON.stringify(message);
  client.down.send(() => {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    client.socket.send(data);
    sentBytes += Buffer.byteLength(data);
  });
}

function marksMessage() {
  return { type: 'marks', marks: [...marks.values()].map(({ owner, ...mark }) => mark) };
}

function broadcastMarks() {
  const message = marksMessage();
  for (const client of participants.values()) post(client, message);
}

function handle(client, raw) {
  let message;
  try {
    message = JSON.parse(raw.toString('utf8'));
  } catch {
    return;
  }

  switch (message?.type) {
    case 'pose': {
      const { p, q } = message;
      if (!validPosition(p) || !Array.isArray(q) || q.length !== 4
        || !q.every(Number.isFinite)) return;
      const length = Math.hypot(...q);
      if (!Number.isFinite(length) || length === 0) return;
      client.pose = { p, q: q.map(n => n / length) };
      break;
    }
    case 'ping':
      if (Number.isFinite(message.t)) post(client, { type: 'pong', t: message.t });
      break;
    case 'mark': {
      const { p } = message;
      const text = typeof message.text === 'string' ? message.text.trim() : '';
      if (!validPosition(p) || !text || text.length > 80) return;
      const id = nextMarkId++;
      marks.set(id, { id, author: client.name, owner: client.identity, text, p });
      broadcastMarks();
      break;
    }
    case 'unmark':
      if (marks.get(message.id)?.owner === client.identity) {
        marks.delete(message.id);
        broadcastMarks();
      }
      break;
    case 'report': {
      if (message.mode !== 'interp' && message.mode !== 'extrap') return;
      const filename = `net-${client.profile}-${message.mode}.json`;
      try {
        mkdirSync(resultsDirectory, { recursive: true });
        writeFileSync(new URL(filename, resultsDirectory),
          JSON.stringify({ ...message, profile: client.profile }, null, 2) + '\n');
        console.log(`Звіт ${client.name}: results/${filename}`);
      } catch (error) {
        console.error(`Звіт ${filename}: ${error.message}`);
      }
      break;
    }
  }
}

server.on('connection', (socket, request) => {
  const params = new URL(request.url, `http://${host}`).searchParams;
  const name = params.get('name')?.trim().slice(0, 20) || 'guest';
  if (participants.has(name)) {
    socket.on('error', () => {});
    socket.close(1008, 'Participant name already in use');
    return;
  }
  const requested = params.get('profile');
  const profile = Object.hasOwn(PROFILES, requested) ? requested : 'lan';
  const up = makeLink(PROFILES[profile]);
  const down = makeLink(PROFILES[profile]);
  const client = { socket, name, profile, up, down, identity: Symbol(name) };
  participants.set(name, client);
  socket.on('message', (raw, binary) => {
    if (!binary) up.send(() => {
      if (socket.readyState === WebSocket.OPEN) handle(client, raw);
    });
  });
  socket.on('error', error => console.error(`${name}: ${error.message}`));
  socket.on('close', () => {
    up.close();
    down.close();
    participants.delete(name);
  });
  post(client, marksMessage());
  console.log(`+ ${name} (${profile}), учасників: ${participants.size}`);
});

server.on('listening', () => console.log(`Сервер сеансу: ws://${host}:${PORT}`));
server.on('error', error => {
  console.error(error.message);
  process.exitCode = 1;
});

const snapshots = setInterval(() => {
  const t = Date.now();
  const poses = [...participants.values()].filter(client => client.pose);
  for (const receiver of participants.values()) {
    const avatars = Object.fromEntries(poses.filter(sender => sender !== receiver)
      .map(sender => [sender.name, sender.pose]));
    post(receiver, { type: 'snap', t, avatars });
  }
}, T_SN);
snapshots.unref();

const traffic = setInterval(() => {
  if (participants.size) {
    console.log(`учасників ${participants.size} · R_c = ${(sentBytes * 8 / 5000).toFixed(1)} кбіт/с`);
  }
  sentBytes = 0;
}, 5000);
traffic.unref();

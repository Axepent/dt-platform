import WebSocket from 'ws';
import { PORT, walk } from '../scene/shared.js';

const socket = new WebSocket(`ws://127.0.0.1:${PORT}/?name=bot&profile=lan`);
let timer;

function sendPose() {
  if (socket.readyState !== WebSocket.OPEN) return;
  const { p } = walk(Date.now());
  socket.send(JSON.stringify({ type: 'pose', p, q: [0, 0, 0, 1] }));
}

socket.on('open', () => {
  console.log('Бот у сеансі. Ctrl+C — зупинка');
  sendPose();
  timer = setInterval(sendPose, 49);
});
socket.on('error', error => {
  console.error('WebSocket бота:', error.message);
  process.exitCode = 1;
});
socket.on('close', (code, reason) => {
  clearInterval(timer);
  if (code === 1008) {
    console.error(reason.toString());
    process.exitCode = 1;
  }
});

export const PORT = 8091;
export const T_SN = 50; // ms, 20 snapshots per second
export const PROFILES = {
  lan: { rtt: 2, jitter: 1, loss: 0, m: 0 },
  city: { rtt: 20, jitter: 5, loss: 0.005, m: 1 },
  mobile: { rtt: 60, jitter: 30, loss: 0.02, m: 1 },
};

export function walk(ms) {
  const radius = 6;
  const speed = 1.5;
  const cycle = 10;
  const moving = 8;
  const seconds = ms / 1000;
  const completed = Math.floor(seconds / cycle);
  const withinCycle = seconds - completed * cycle;
  const path = (completed * moving + Math.min(withinCycle, moving)) * speed;
  const angle = (path % (2 * Math.PI * radius)) / radius;
  return {
    p: [radius * Math.cos(angle), 1.7, radius * Math.sin(angle)],
    steady: withinCycle > 1 && withinCycle < moving,
  };
}

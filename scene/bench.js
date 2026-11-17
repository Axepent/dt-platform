// Run with ?bench=30&label=before. The original frame callback remains shared.
const WARMUP_SECONDS = 3;
const WIDTH = 1920;
const HEIGHT = 1080;

function percentile(values, fraction) {
  const sorted = values.toSorted((a, b) => a - b);
  if (!sorted.length) return null;
  return rounded(sorted[Math.ceil(fraction * sorted.length) - 1]);
}

const rounded = value => Number(value.toFixed(2));
const megabytes = bytes => rounded(bytes / 1e6);

function textureBytes(scene) {
  const seen = new Set();
  let bytes = 0;
  scene.traverse(object => {
    for (const material of [object.material].flat()) {
      for (const texture of Object.values(material ?? {})) {
        if (!texture?.isTexture || seen.has(texture)) continue;
        seen.add(texture);
        if (texture.isCompressedTexture) {
          bytes += texture.mipmaps.reduce((sum, level) => sum + level.data.byteLength, 0);
        } else if (texture.image) {
          const { width, height, data } = texture.image;
          const baseBytes = data?.byteLength ?? width * height * 4;
          if (Number.isFinite(baseBytes)) bytes += baseBytes * (texture.generateMipmaps ? 4 / 3 : 1);
        }
      }
    }
  });
  return bytes;
}

export function startBenchmark({ renderer, scene, camera, controls, frame, opt, params }) {
  const duration = Math.max(1, Math.min(120, Number(params.get('bench')) || 30));
  const hz = Math.max(1, Number(params.get('hz')) || 60);
  const label = (params.get('label') || 'run').replace(/[^\w-]/g, '_');
  const budget = 1000 / hz;

  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.domElement.style.width = '100vw';
  renderer.domElement.style.height = '100vh';
  renderer.domElement.style.objectFit = 'contain';
  camera.aspect = WIDTH / HEIGHT;
  camera.updateProjectionMatrix();
  controls.enabled = false;

  const panel = document.createElement('section');
  panel.setAttribute('aria-label', 'Профілювання');
  const progress = document.createElement('p');
  progress.style.margin = '8px 0';
  panel.append(progress);
  document.getElementById('hud').append(panel);

  const gl = renderer.getContext();
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const gpuRenderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null;
  const pending = [];
  const samples = [];
  const periods = [];
  let firstTick = null;
  let lastSampleTick = null;
  let visible = !document.hidden;

  function onVisibilityChange() {
    if (document.hidden) visible = false;
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  function pollGpu() {
    if (!timer || !pending.length) return;
    if (gl.getParameter(timer.GPU_DISJOINT_EXT)) {
      for (const { query } of pending) gl.deleteQuery(query);
      pending.length = 0;
      return;
    }
    while (pending.length && gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
      const { query, sample } = pending.shift();
      sample.gpu = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(query);
    }
  }

  function cameraPath(seconds) {
    const angle = 2 * Math.PI * seconds / 20;
    const radius = 8 + 150 * (1 - Math.cos(2 * Math.PI * seconds / 30));
    camera.position.set(radius * Math.cos(angle), 2 + 0.4 * radius, radius * Math.sin(angle));
    controls.target.set(0, 0.5, 0);
    camera.lookAt(controls.target);
  }

  function saveResult() {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    const validGpu = samples.filter(sample => Number.isFinite(sample.gpu));
    const gpuTimes = validGpu.map(sample => sample.gpu);
    const cpuTimes = samples.map(sample => sample.cpu);
    const calls = samples.map(sample => sample.calls);
    const triangles = samples.map(sample => sample.triangles);
    const inBudget = validGpu.filter(({ cpu, gpu }) => Math.max(cpu, gpu) <= budget).length;
    const firstFrame = performance.getEntriesByName('first-frame', 'mark')[0]?.startTime;
    const resources = performance.getEntriesByType('resource');
    const resourceBytes = entries => entries.reduce((sum, entry) => sum + entry.encodedBodySize, 0);
    const result = {
      label,
      opt: [...opt].join(','),
      resolution: [WIDTH, HEIGHT],
      gpu_renderer: gpuRenderer,
      gpu_timer_available: Boolean(timer),
      visible_for_full_run: visible,
      warmup_s: WARMUP_SECONDS,
      duration_s: duration,
      budget_ms: rounded(budget),
      frames: samples.length,
      fps: rounded(samples.length / duration),
      frame_p50_ms: percentile(periods, 0.5),
      frame_p99_ms: percentile(periods, 0.99),
      cpu_p50_ms: percentile(cpuTimes, 0.5),
      cpu_p99_ms: percentile(cpuTimes, 0.99),
      gpu_p50_ms: percentile(gpuTimes, 0.5),
      gpu_p99_ms: percentile(gpuTimes, 0.99),
      gpu_samples: validGpu.length,
      gpu_coverage_pct: samples.length ? rounded(100 * validGpu.length / samples.length) : 0,
      in_budget_pct: validGpu.length ? rounded(100 * inBudget / validGpu.length) : null,
      cpu_in_budget_pct: samples.length
        ? rounded(100 * cpuTimes.filter(time => time <= budget).length / samples.length) : null,
      calls_p50: percentile(calls, 0.5),
      calls_max: calls.length ? Math.max(...calls) : null,
      triangles_p50: percentile(triangles, 0.5),
      triangles_max: triangles.length ? Math.max(...triangles) : null,
      textures_mb: megabytes(textureBytes(scene)),
      first_frame_ms: firstFrame === undefined ? null : Math.round(firstFrame),
      data_first_frame_mb: firstFrame === undefined ? null
        : megabytes(resourceBytes(resources.filter(entry => entry.responseEnd <= firstFrame))),
      data_total_mb: megabytes(resourceBytes(resources)),
      requests: resources.length,
    };
    const json = JSON.stringify(result, null, 2);
    const link = document.createElement('a');
    link.download = `perf-${label}.json`;
    link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    link.textContent = `Зберегти ${link.download}`;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Показати результат';
    const output = document.createElement('pre');
    output.style.cssText = 'max-height:28vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere';
    output.textContent = json;
    details.append(summary, output);
    progress.textContent = visible ? 'Профілювання завершено' : 'Вкладку приховано під час прогону. Повторіть замір.';
    panel.append(link, details);
    console.log('Scene benchmark', result);
  }

  function finish() {
    renderer.setAnimationLoop(null);
    progress.textContent = 'Завершення вимірювання ГП…';
    const deadline = performance.now() + 800;
    function drain() {
      pollGpu();
      if (pending.length && performance.now() < deadline) {
        setTimeout(drain, 16);
        return;
      }
      for (const { query } of pending) gl.deleteQuery(query);
      saveResult();
    }
    drain();
  }

  renderer.setAnimationLoop(time => {
    firstTick ??= time;
    const elapsed = (time - firstTick) / 1000;
    if (elapsed >= WARMUP_SECONDS + duration) {
      finish();
      return;
    }

    cameraPath(Math.max(0, elapsed - WARMUP_SECONDS));
    pollGpu();
    const measuring = elapsed >= WARMUP_SECONDS;
    const sample = {};
    const query = measuring && timer && pending.length < 120 ? gl.createQuery() : null;
    if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    const start = performance.now();
    frame(time);
    sample.cpu = performance.now() - start;
    if (query) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      pending.push({ query, sample });
    }
    if (measuring) {
      if (lastSampleTick !== null) periods.push(time - lastSampleTick);
      lastSampleTick = time;
      const { calls, triangles } = renderer.info.render;
      samples.push(Object.assign(sample, { calls, triangles }));
    }
    progress.textContent = measuring
      ? `Замір: ${Math.floor(elapsed - WARMUP_SECONDS)} / ${duration} с`
      : `Прогрів: ${Math.ceil(WARMUP_SECONDS - elapsed)} с`;
  });
}

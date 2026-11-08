// Show a placeholder when a video or image file is missing instead of an empty box.
function markMissing(media, label) {
  media.classList.add('missing');
  media.dataset.missing = label;
}
document.querySelectorAll('.media video').forEach((video) => {
  const sources = [...video.querySelectorAll('source')];
  const last = sources[sources.length - 1];
  const media = video.closest('.media');
  // Only a real load failure counts. networkState can read NO_SOURCE briefly while the browser is still
  // picking a source, so it is checked after the page has loaded, not when this script runs.
  const fail = () => markMissing(media, 'Video coming soon');
  if (last) last.addEventListener('error', fail);
  video.addEventListener('error', fail);
  window.addEventListener('load', () => {
    if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE && !video.currentSrc) fail();
  });
});
document.querySelectorAll('.media img').forEach((img) => {
  const media = img.closest('.media');
  if (img.complete && img.naturalWidth === 0) markMissing(media, 'Image coming soon');
  else img.addEventListener('error', () => markMissing(media, 'Image coming soon'));
});

// Synced views: every video in a stack plays together; the buttons choose which one is visible.
document.querySelectorAll('.view-switch').forEach((group) => {
  const videos = [...group.querySelectorAll('.stack video')];
  const buttons = [...group.querySelectorAll('.segmented button')];
  let active = 0;

  function select(index) {
    const time = videos[active].currentTime;
    const playing = !videos[active].paused;
    active = index;
    videos.forEach((video, i) => {
      video.classList.toggle('active', i === index);
      video.toggleAttribute('inert', i !== index);
      if (Math.abs(video.currentTime - time) > 0.05) video.currentTime = time;
      if (playing) video.play().catch(() => {});
    });
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
  }

  buttons.forEach((button, i) => button.addEventListener('click', () => select(i)));
  videos.forEach((video, i) => i !== active && video.setAttribute('inert', ''));

  // The visible video leads; the hidden ones follow its play state and position.
  videos.forEach((video) => {
    const others = () => videos.filter((other) => other !== video);
    const isLeader = () => video === videos[active];
    video.addEventListener('play', () => isLeader() && others().forEach((o) => o.play().catch(() => {})));
    video.addEventListener('pause', () => isLeader() && others().forEach((o) => o.pause()));
    video.addEventListener('seeked', () => isLeader() && others().forEach((o) => { o.currentTime = video.currentTime; }));
    video.addEventListener('timeupdate', () => {
      if (!isLeader()) return;
      others().forEach((o) => {
        if (Math.abs(o.currentTime - video.currentTime) > 0.1) o.currentTime = video.currentTime;
      });
    });
  });
});

// Independent clips: the buttons choose which video is shown; only that one plays, from the start.
document.querySelectorAll('.clip-switch').forEach((group) => {
  const videos = [...group.querySelectorAll('.stack video')];
  const buttons = [...group.querySelectorAll('.segmented button')];
  videos.forEach((video, i) => i !== 0 && video.setAttribute('inert', ''));
  buttons.forEach((button, index) => button.addEventListener('click', () => {
    videos.forEach((video, i) => {
      const on = i === index;
      video.classList.toggle('active', on);
      video.toggleAttribute('inert', !on);
      if (on) { video.currentTime = 0; video.play().catch(() => {}); } else video.pause();
    });
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
  }));
});

// Scrubber: a custom seek bar for stepping through a fast demonstration. It announces its time as a
// `timeline` event so linked graphs can follow along. Until the video exists, a virtual clock of
// data-duration seconds stands in for it. Any further videos in the scrubber share the first one's
// timeline: they follow its play state, rate and position.
document.querySelectorAll('.scrubber').forEach((scrubber) => {
  const video = scrubber.querySelector('video');
  const followers = [...scrubber.querySelectorAll('video')].slice(1);
  const playButton = scrubber.querySelector('.scrub-play');
  const range = scrubber.querySelector('.scrub-range');
  const label = scrubber.querySelector('.scrub-time');
  const speeds = [...scrubber.querySelectorAll('.scrub-speed button')];
  const fallbackDuration = Number(scrubber.dataset.duration) || 4;
  // Assume the video exists until it fails to load; networkState is unreliable this early.
  let hasVideo = true;
  let time = 0;
  let rate = 1;
  let playing = false;
  let last = 0;
  let frame;

  const duration = () => (hasVideo && video.duration) || fallbackDuration;
  const sources = video.querySelectorAll('source');
  sources[sources.length - 1]?.addEventListener('error', () => { hasVideo = false; render(); });

  // Coalesced seeking: while a video is still seeking, remember only the newest target and apply it once
  // that seek lands, so a fast drag keeps presenting frames instead of aborting every seek in flight.
  function seekVideo(v, t) {
    t = Math.min(t, v.duration || t);
    if (v.seeking) { v.pendingSeek = t; return; }
    v.pendingSeek = null;
    if (Math.abs(v.currentTime - t) > 1e-3) v.currentTime = t;
  }
  [video, ...followers].forEach((v) => {
    v.addEventListener('seeked', () => {
      if (v.pendingSeek == null) return;
      const t = v.pendingSeek;
      v.pendingSeek = null;
      v.currentTime = t;
    });
    // Load the whole file into memory so seeking is local and never depends on HTTP range support.
    const src = v.querySelector('source')?.src;
    if (!src || !window.fetch) return;
    fetch(src).then((r) => (r.ok ? r.blob() : null)).then((blob) => {
      if (!blob) return;
      v.addEventListener('loadedmetadata', () => seekVideo(v, time), { once: true });
      v.src = URL.createObjectURL(blob);
      v.playbackRate = rate;
      if (playing) v.play().catch(() => {});
    }).catch(() => {});
  });
  function follow(force) {
    followers.forEach((f) => {
      if (force) seekVideo(f, time);
      else if (!f.seeking && Math.abs(f.currentTime - time) > 0.08) f.currentTime = Math.min(time, f.duration || time);
    });
  }
  function render() {
    const fraction = Math.min(1, time / duration());
    range.value = String(Math.round(fraction * 1000));
    range.style.setProperty('--progress', `${fraction * 100}%`);
    label.textContent = `${time.toFixed(2)} / ${duration().toFixed(2)} s`;
    scrubber.dispatchEvent(new CustomEvent('timeline', { detail: { time, duration: duration() } }));
  }
  function loop(now) {
    if (hasVideo) time = video.currentTime;
    else time += ((now - last) / 1000) * rate;
    last = now;
    if (time >= duration()) {
      time = duration();
      pause();
      return;
    }
    render();
    follow(false);
    frame = requestAnimationFrame(loop);
  }
  function play() {
    if (time >= duration() - 0.01) seek(0);
    playing = true;
    playButton.classList.add('playing');
    playButton.setAttribute('aria-label', 'Pause');
    if (hasVideo) video.play().catch(() => {});
    follow(true);
    followers.forEach((f) => f.play().catch(() => {}));
    last = performance.now();
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(loop);
  }
  function pause() {
    playing = false;
    playButton.classList.remove('playing');
    playButton.setAttribute('aria-label', 'Play');
    if (hasVideo) { video.pause(); time = video.currentTime; }
    followers.forEach((f) => f.pause());
    cancelAnimationFrame(frame);
    render();
    follow(true);
  }
  function seek(t) {
    time = Math.min(duration(), Math.max(0, t));
    if (hasVideo) seekVideo(video, time);
    render();
    follow(true);
  }
  scrubber.seek = (t) => { pause(); seek(t); };

  playButton.addEventListener('click', () => (playing ? pause() : play()));
  [video, ...followers].forEach((v) => v.addEventListener('click', () => playButton.click()));
  video.addEventListener('ended', pause);
  video.addEventListener('loadedmetadata', () => { hasVideo = true; render(); });
  video.addEventListener('error', () => { hasVideo = false; render(); });
  range.addEventListener('input', () => scrubber.seek((Number(range.value) / 1000) * duration()));
  speeds.forEach((button) => button.addEventListener('click', () => {
    rate = Number(button.dataset.rate);
    [video, ...followers].forEach((v) => { v.playbackRate = rate; });
    speeds.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  }));
  render();
});

// Graphs linked to a scrubber: the playhead follows the video, scroll zooms, drag pans,
// click seeks and double-click resets. Data is JSON shaped like
// { "xLabel": "Time (s)", "yLabel": "...", "series": [{ "name": "...", "t": [...], "y": [...] }] }.
const GRAPH_COLORS = ['#1772d0', '#e07b1a', '#2a9d6f', '#8b4fd4'];
const PLACEHOLDER_GRAPHS = {
  velocity: (duration) => {
    const t = Array.from({ length: 241 }, (_, i) => (i / 240) * duration);
    return {
      xLabel: 'Time (s)',
      yLabel: 'Joint velocity (rad/s)',
      series: [
        { name: 'Shoulder', t, y: t.map((x) => 3.2 * Math.sin(2.1 * x) * Math.exp(-0.15 * x)) },
        { name: 'Elbow', t, y: t.map((x) => 4.5 * Math.sin(2.1 * x + 0.9) * Math.sin(0.8 * x)) },
      ],
    };
  },
  error: (duration) => {
    const t = Array.from({ length: 241 }, (_, i) => (i / 240) * duration);
    return {
      xLabel: 'Time (s)',
      yLabel: 'Tracking error (mm)',
      series: [{ name: 'Error', t, y: t.map((x) => 1.2 + 0.8 * Math.abs(Math.sin(2.1 * x)) + 0.3 * Math.sin(17 * x)) }],
    };
  },
};

function niceTicks(a, b, count = 5) {
  const rough = (b - a) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual >= 7.5 ? 10 : residual >= 3.5 ? 5 : residual >= 1.5 ? 2 : 1) * magnitude;
  const ticks = [];
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-6; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

function nearestIndex(values, target) {
  let lo = 0;
  let hi = values.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < target) lo = mid;
    else hi = mid;
  }
  return Math.abs(values[lo] - target) <= Math.abs(values[hi] - target) ? lo : hi;
}

document.querySelectorAll('.graph').forEach(async (figure, graphIndex) => {
  const svg = figure.querySelector('.graph-plot');
  const readout = figure.querySelector('.graph-readout');
  const reset = figure.querySelector('.graph-reset');
  const timeline = document.getElementById(figure.dataset.timeline);
  const W = 460, H = 260;
  const plot = { left: 50, right: W - 12, top: 12, bottom: H - 38 };

  let data;
  try {
    const response = await fetch(figure.dataset.src);
    if (!response.ok) throw new Error(response.statusText);
    data = await response.json();
  } catch {
    data = PLACEHOLDER_GRAPHS[figure.dataset.placeholder](Number(timeline?.dataset.duration) || 4);
    data.placeholder = true;
  }

  const allT = data.series.flatMap((s) => s.t);
  const domain = [Math.min(...allT), Math.max(...allT)];
  let view = [...domain];
  let playhead = 0;
  let hover = null;

  const toX = (t) => plot.left + ((t - view[0]) / (view[1] - view[0])) * (plot.right - plot.left);
  const fromClient = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    return view[0] + ((x - plot.left) / (plot.right - plot.left)) * (view[1] - view[0]);
  };

  function setView(start, end) {
    const minSpan = (domain[1] - domain[0]) / 50;
    let span = Math.min(domain[1] - domain[0], Math.max(minSpan, end - start));
    start = Math.min(domain[1] - span, Math.max(domain[0], start));
    view = [start, start + span];
    reset.hidden = span >= domain[1] - domain[0] - 1e-9;
    render();
  }

  function valuesAt(t) {
    return data.series.map((s) => s.y[nearestIndex(s.t, t)]);
  }

  function render() {
    const visible = data.series.flatMap((s) => s.y.filter((_, i) => s.t[i] >= view[0] && s.t[i] <= view[1]));
    let [lo, hi] = [Math.min(...visible), Math.max(...visible)];
    if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
    const pad = (hi - lo || 1) * 0.08;
    [lo, hi] = [lo - pad, hi + pad];
    const toY = (v) => plot.bottom - ((v - lo) / (hi - lo)) * (plot.bottom - plot.top);
    const clip = `graph-clip-${graphIndex}`;

    const xTicks = niceTicks(view[0], view[1], 5).map((t) => `
      <line class="grid" x1="${toX(t)}" x2="${toX(t)}" y1="${plot.top}" y2="${plot.bottom}"/>
      <text class="tick" x="${toX(t)}" y="${plot.bottom + 16}" text-anchor="middle">${+t.toFixed(3)}</text>`).join('');
    const yTicks = niceTicks(lo, hi, 4).map((v) => `
      <line class="grid" x1="${plot.left}" x2="${plot.right}" y1="${toY(v)}" y2="${toY(v)}"/>
      <text class="tick" x="${plot.left - 6}" y="${toY(v) + 4}" text-anchor="end">${+v.toFixed(3)}</text>`).join('');
    const lines = data.series.map((s, i) => {
      const d = s.t.map((t, j) => `${j ? 'L' : 'M'}${toX(t).toFixed(1)},${toY(s.y[j]).toFixed(1)}`).join('');
      return `<path class="series" d="${d}" stroke="${GRAPH_COLORS[i % GRAPH_COLORS.length]}"/>`;
    }).join('');
    const marker = (t, cls) => (t >= view[0] && t <= view[1]
      ? `<line class="${cls}" x1="${toX(t)}" x2="${toX(t)}" y1="${plot.top}" y2="${plot.bottom}"/>
         ${valuesAt(t).map((v, i) => `<circle class="${cls}-dot" cx="${toX(t)}" cy="${toY(v)}" r="3.5" fill="${GRAPH_COLORS[i % GRAPH_COLORS.length]}"/>`).join('')}`
      : '');

    svg.innerHTML = `
      <defs><clipPath id="${clip}"><rect x="${plot.left}" y="${plot.top - 6}" width="${plot.right - plot.left}" height="${plot.bottom - plot.top + 12}"/></clipPath></defs>
      ${xTicks}${yTicks}
      <line class="axis" x1="${plot.left}" x2="${plot.right}" y1="${plot.bottom}" y2="${plot.bottom}"/>
      <text class="axis-label" x="${(plot.left + plot.right) / 2}" y="${H - 4}" text-anchor="middle">${data.xLabel}</text>
      <text class="axis-label" x="12" y="${(plot.top + plot.bottom) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(plot.top + plot.bottom) / 2})">${data.yLabel}</text>
      ${data.placeholder ? `<text class="placeholder-note" x="${plot.right - 4}" y="${plot.top + 12}" text-anchor="end">placeholder data</text>` : ''}
      <g clip-path="url(#${clip})">${lines}${marker(playhead, 'playhead')}${hover === null ? '' : marker(hover, 'hover')}</g>
    `;
    const t = hover ?? playhead;
    readout.innerHTML = `<span>t = ${t.toFixed(2)} s</span>` + data.series.map((s, i) =>
      `<span><i style="background:${GRAPH_COLORS[i % GRAPH_COLORS.length]}"></i>${s.name} ${valuesAt(t)[i].toFixed(2)}</span>`).join('');
  }

  timeline?.addEventListener('timeline', (event) => {
    playhead = event.detail.time;
    render();
  });

  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const t = fromClient(event.clientX);
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      const shift = (event.deltaX / 400) * (view[1] - view[0]);
      setView(view[0] + shift, view[1] + shift);
      return;
    }
    const scale = Math.exp(event.deltaY * 0.0025);
    setView(t - (t - view[0]) * scale, t + (view[1] - t) * scale);
  }, { passive: false });

  let drag = null;
  svg.addEventListener('pointerdown', (event) => {
    svg.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, view: [...view], moved: false };
  });
  svg.addEventListener('pointermove', (event) => {
    if (drag) {
      const rect = svg.getBoundingClientRect();
      const dx = event.clientX - drag.x;
      if (Math.abs(dx) > 3) drag.moved = true;
      if (drag.moved) {
        svg.classList.add('panning');
        const shift = -(dx / rect.width) * (W / (plot.right - plot.left)) * (drag.view[1] - drag.view[0]);
        setView(drag.view[0] + shift, drag.view[1] + shift);
      }
    }
    hover = Math.min(view[1], Math.max(view[0], fromClient(event.clientX)));
    render();
  });
  svg.addEventListener('pointerup', (event) => {
    if (drag && !drag.moved) timeline?.seek(fromClient(event.clientX));
    svg.classList.remove('panning');
    drag = null;
  });
  svg.addEventListener('pointerleave', () => { hover = null; render(); });
  svg.addEventListener('dblclick', () => setView(...domain));
  reset.addEventListener('click', () => setView(...domain));
  render();
});

// Test-time smoothing: blend two overlapping action chunks with a sigmoid weight.
(() => {
  const demo = document.querySelector('.smoothing-demo');
  if (!demo) return;
  const svg = demo.querySelector('.smoothing-plot');
  const stat = demo.querySelector('.smoothing-stat');
  const T = 24; // action chunk size
  const params = { H: 8, sigma: 1.5 };
  const limits = { H: { min: 2, max: 16, step: 1 }, sigma: { min: 0.25, max: 5, step: 0.25 } };

  // Chunk 2 is predicted later from a fresh observation, so it disagrees with chunk 1 where they overlap.
  const truth = (t) => 0.8 * Math.sin(t / 7);
  const chunk1 = (t) => truth(t) + 0.025 * t;
  const chunk2 = (t, start) => truth(t) - 0.3 + 0.01 * (t - start);
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  const W = 720, left = 44, right = 16;
  const main = { top: 16, bottom: 236 };
  const inset = { top: 270, bottom: 336 };
  const xMax = 2 * T - 2;
  const x = (t) => left + (t / xMax) * (W - left - right);
  const yMain = (v) => main.bottom - ((v + 1.4) / 3) * (main.bottom - main.top);
  const yWeight = (w) => inset.bottom - w * (inset.bottom - inset.top);
  const path = (points) => points.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');

  function draw() {
    const { H, sigma } = params;
    const start = T - H; // timestep at which chunk 2 is predicted
    const end = 2 * T - H;
    const weight = (t) => sigmoid(((t - start) - H / 2) / sigma);
    const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

    const blended = range(0, end).map((t) => {
      if (t < start) return chunk1(t);
      if (t >= T) return chunk2(t, start);
      const w = weight(t);
      return (1 - w) * chunk1(t) + w * chunk2(t, start);
    });
    const raw = range(0, end).map((t) => (t < start ? chunk1(t) : chunk2(t, start)));
    const maxJump = (values) => Math.max(...values.slice(1).map((v, i) => Math.abs(v - values[i])));

    const ticks = range(0, xMax + 1).filter((t) => t % 8 === 0)
      .map((t) => `<text class="tick" x="${x(t)}" y="${main.bottom + 16}" text-anchor="middle">${t}</text>`).join('');
    const marker = (t, label) => `<text class="label" x="${x(t)}" y="${main.top + 12}" text-anchor="middle">${label}</text>`;

    svg.innerHTML = `
      <rect class="overlap" x="${x(start)}" y="${main.top}" width="${x(T - 1) - x(start)}" height="${main.bottom - main.top}"/>
      <rect class="overlap" x="${x(start)}" y="${inset.top}" width="${x(T - 1) - x(start)}" height="${inset.bottom - inset.top}"/>
      ${marker(start + (T - 1 - start) / 2, `overlap, H = ${H}`)}
      <line class="axis" x1="${left}" x2="${W - right}" y1="${main.bottom}" y2="${main.bottom}"/>
      <line class="axis" x1="${left}" x2="${W - right}" y1="${inset.bottom}" y2="${inset.bottom}"/>
      <line class="axis" x1="${left}" x2="${left}" y1="${main.top}" y2="${main.bottom}"/>
      <line class="axis" x1="${left}" x2="${left}" y1="${inset.top}" y2="${inset.bottom}"/>
      ${ticks}
      <text class="tick" x="${W - right}" y="${main.bottom + 30}" text-anchor="end">timestep t′</text>
      <text class="label" x="${left - 8}" y="${(main.top + main.bottom) / 2}" text-anchor="middle" transform="rotate(-90 ${left - 8} ${(main.top + main.bottom) / 2})" dy="-10">joint position</text>
      <text class="tick" x="${left - 6}" y="${yWeight(1) + 4}" text-anchor="end">1</text>
      <text class="tick" x="${left - 6}" y="${yWeight(0) + 4}" text-anchor="end">0</text>
      <text class="label" x="${left + 6}" y="${inset.top - 6}">w(t′)</text>
      <path class="chunk1" d="${path(range(0, T).map((t) => [x(t), yMain(chunk1(t))]))}"/>
      <path class="chunk2" d="${path(range(start, end).map((t) => [x(t), yMain(chunk2(t, start))]))}"/>
      <path class="raw" d="${path(raw.map((v, t) => [x(t), yMain(v)]))}"/>
      <path class="blended" d="${path(blended.map((v, t) => [x(t), yMain(v)]))}"/>
      ${blended.map((v, t) => `<circle class="dot" cx="${x(t)}" cy="${yMain(v)}" r="2.2"/>`).join('')}
      <path class="weight-faint" d="${path(range(0, 4 * T).map((i) => i / 2).filter((t) => t <= xMax).map((t) => [x(t), yWeight(weight(t))]))}"/>
      <path class="weight" d="${path(range(start * 4, (T - 1) * 4 + 1).map((i) => i / 4).map((t) => [x(t), yWeight(weight(t))]))}"/>
    `;
    stat.textContent = `Largest step between consecutive actions: ${maxJump(blended).toFixed(3)} smoothed vs. ${maxJump(raw).toFixed(3)} without smoothing`;
  }

  function set(name, value) {
    const { min, max, step } = limits[name];
    params[name] = Math.min(max, Math.max(min, Math.round(value / step) * step));
    demo.querySelectorAll(`[data-param="${name}"]`).forEach((el) => {
      if (el.tagName === 'INPUT') el.value = String(params[name]);
      else el.textContent = String(params[name]);
      if (el.getAttribute('role') === 'slider') {
        el.setAttribute('aria-valuenow', String(params[name]));
        el.setAttribute('aria-valuemin', String(min));
        el.setAttribute('aria-valuemax', String(max));
      }
    });
    draw();
  }

  demo.querySelectorAll('input[data-param]').forEach((input) => {
    input.addEventListener('input', () => set(input.dataset.param, Number(input.value)));
  });

  // Drag the numbers in the equation left and right to change them.
  demo.querySelectorAll('.num').forEach((num) => {
    const name = num.dataset.param;
    num.title = 'Drag left or right to change';
    num.addEventListener('pointerdown', (event) => {
      const startX = event.clientX;
      const startValue = params[name];
      num.setPointerCapture(event.pointerId);
      num.classList.add('dragging');
      const move = (e) => set(name, startValue + Math.round((e.clientX - startX) / 12) * limits[name].step);
      const up = () => {
        num.classList.remove('dragging');
        num.removeEventListener('pointermove', move);
        num.removeEventListener('pointerup', up);
        num.removeEventListener('pointercancel', up);
      };
      num.addEventListener('pointermove', move);
      num.addEventListener('pointerup', up);
      num.addEventListener('pointercancel', up);
    });
    num.addEventListener('keydown', (event) => {
      const delta = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
      if (!delta) return;
      event.preventDefault();
      set(name, params[name] + delta * limits[name].step);
    });
  });

  set('H', params.H);
  set('sigma', params.sigma);
})();

// Flip the smoothing demo between our method and temporal ensembling.
document.querySelectorAll('.smoothing-demo').forEach((demo) => {
  const buttons = [...demo.querySelectorAll('.method-toggle button')];
  const panels = [...demo.querySelectorAll('.method-panel')];
  buttons.forEach((button) => button.addEventListener('click', () => {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== button.dataset.panel; });
  }));
});

// Temporal ensembling (static): a chunk is predicted at every timestep, and the executed action
// averages every chunk's prediction for the current step, weighted w_i = exp(-m * i), oldest first.
(() => {
  const svg = document.querySelector('.te-plot');
  if (!svg) return;
  const K = 8; // chunk size
  const now = 12; // highlighted timestep t
  const m = 0.25;
  const truth = (t) => 0.5 * Math.sin(t / 5);
  const chunk = (start, t) => truth(t) + 0.2 * (start - 8) - 0.02 * (t - start); // newer chunks have shifted their plan upward
  const W = 720, left = 30, right = 20, top = 20, bottom = 250, xMax = 20;
  const x = (t) => left + (t / xMax) * (W - left - right);
  const y = (v) => bottom - ((v + 1.6) / 3.2) * (bottom - top);

  const ensemble = (t) => {
    const starts = [];
    for (let s = Math.max(0, t - K + 1); s <= t; s++) starts.push(s);
    const weights = starts.map((_, i) => Math.exp(-m * i));
    const total = weights.reduce((a, b) => a + b, 0);
    return { starts, weights, value: starts.reduce((sum, s, i) => sum + weights[i] * chunk(s, t), 0) / total };
  };

  const { starts, weights, value } = ensemble(now);
  const maxWeight = Math.max(...weights);
  const chunkLines = starts.map((s, i) => {
    const points = Array.from({ length: K }, (_, k) => s + k).map((t, k) => `${k ? 'L' : 'M'}${x(t).toFixed(1)},${y(chunk(s, t)).toFixed(1)}`).join('');
    return `<path class="te-chunk" d="${points}" style="stroke-opacity:${0.25 + 0.55 * (weights[i] / maxWeight)}"/>`;
  }).join('');
  const executed = Array.from({ length: now + 1 }, (_, t) => `${t ? 'L' : 'M'}${x(t).toFixed(1)},${y(ensemble(t).value).toFixed(1)}`).join('');
  const dots = starts.map((s, i) => `<circle class="te-dot" cx="${x(now)}" cy="${y(chunk(s, now))}" r="${(2.5 + 5 * (weights[i] / maxWeight)).toFixed(1)}"/>`).join('');
  const oldest = chunk(starts[0], now);
  const newest = chunk(starts[starts.length - 1], now);

  svg.innerHTML = `
    <line class="axis" x1="${left}" x2="${W - right}" y1="${bottom}" y2="${bottom}"/>
    ${Array.from({ length: xMax / 4 + 1 }, (_, i) => i * 4).map((t) => `<text class="tick" x="${x(t)}" y="${bottom + 16}" text-anchor="middle">${t}</text>`).join('')}
    <text class="tick" x="${W - right}" y="${bottom + 32}" text-anchor="end">timestep</text>
    <line class="te-now" x1="${x(now)}" x2="${x(now)}" y1="${top}" y2="${bottom}"/>
    <text class="label" x="${x(now)}" y="${top - 6}" text-anchor="middle">t</text>
    ${chunkLines}
    <path class="te-executed" d="${executed}"/>
    ${dots}
    <circle class="te-result" cx="${x(now)}" cy="${y(value)}" r="6"/>
    <text class="label" x="${x(now) + 14}" y="${y(oldest) + 4}">i = 0, oldest</text>
    <text class="label" x="${x(now) + 14}" y="${y(newest) + 4}">i = ${starts.length - 1}, newest</text>
    <text class="label strong" x="${x(now) - 12}" y="${y(value) + 4}" text-anchor="end">a<tspan baseline-shift="sub" font-size="10">t</tspan> (weighted average)</text>
  `;
})();

// Copy BibTeX
document.querySelectorAll('.copy-bibtex').forEach((button) => {
  button.addEventListener('click', async () => {
    const text = button.parentElement.querySelector('code').textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Press Ctrl+C';
      const selection = window.getSelection();
      selection.selectAllChildren(button.parentElement.querySelector('code'));
    }
    setTimeout(() => { button.textContent = 'Copy'; }, 1800);
  });
});

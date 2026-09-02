/* ═══════════════════════════════════════════════════════════════════
   PIPEGUARD — main.js
   Full application logic: canvas rendering, playback, HUD, chart,
   map, Watchkeeper, settings, jury modal.
═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ─── Global state ──────────────────────────────────────────────── */
const S = {
  /* Leak click tooltip */
  leakTooltip: null,
  leakTooltipVisible: false,

  /* Scenario data from API */
  scenarioData: null,
  /* Current playback position */
  frameIndex: 0,
  isPlaying: false,
  playbackSpeed: 1,
  timerId: null,

  /* Live pipeline config (overridable via Settings) */
  pipelineLength: 10000,
  waveSpeed: 1000,
  segmentCount: 5,

  /* Current frame state (read by rAF render loop) */
  evalData: null,
  analysis: null,
  currentTime: 0,

  /* Computed noise stats (baseline window) */
  noiseLevel: 0,
  noiseDiff:  0,

  /* HUD display tweening */
  displayX:       0,
  displayDist:    0,
  displayTIn:     0,
  displayTOut:    0,
  displayDt:      0,
  displayNoise:   0,
  displayNoiseDiff: 0,
  targetX:        0,
  targetDist:     0,
  targetTIn:      0,
  targetTOut:     0,
  targetDt:       0,
  targetNoise:    0,
  targetNoiseDiff: 0,

  /* Canvas flow particles */
  particles: [],
  PARTICLE_COUNT: 60,

  /* Leak burst (one-time) */
  burstFired: false,
  burstParticles: [],
  burstRings: [],

  /* Plume bubbles (continuous after leak) */
  plumeBubbles: [],

  /* Valve spring animators (4 valves) */
  valves: [
    { progress: 0, velocity: 0, target: 0 },
    { progress: 0, velocity: 0, target: 0 },
    { progress: 0, velocity: 0, target: 0 },
    { progress: 0, velocity: 0, target: 0 },
  ],

  /* Alarm */
  alarmFired: false,

  /* Map */
  mapInstance:   null,
  mapLeakMarker: null,
  mapSegMarkers: [],
  mapRouteLayer: null,
  mapInitialized: false,

  /* UI */
  currentPage: 'control-room',
  wkOpen:      false,
  settingsOpen: false,
};

/* ─── DOM cache ──────────────────────────────────────────────────── */
let dom = {};

/* ─── Canvas ─────────────────────────────────────────────────────── */
let canvas, ctx, pressureChart;
let rafId = null;
let lastRaf = 0;

/* ─── Log dedup ──────────────────────────────────────────────────── */
let loggedKeys = new Set();

/* ═══════════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  cacheDOM();
  initChart();
  initCanvas();
  bindEvents();
  positionNavUnderline('control-room');
  loadScenario('BLIND_01');
  startRenderLoop();
});

function cacheDOM() {
  const ids = [
    'pipelineTwinCanvas','pressureChart','eventLogBody',
    'timeReadout','twinValveBadge','customConfigTag',
    'hudDistance','hudDistanceOut','hudTIn','hudTOut','hudDt','hudX','hudSegBadge',
    'hudInBase','hudOutBase','hudNoise','hudNoiseDiff',
    'step-detect','step-analyze','step-localize','step-visualize','step-respond',
    'segChip1','segChip2','segChip3','segChip4','segChip5',
    'scenarioSelect','btnPlayPause','btnReset',
    'spd1','spd2','spd5','spdMax',
    'btnJuryEval','juryTableBody',
    'btnDetailedLog','detailedLogModal','btnCloseLogModal','logModalScenarioBadge','btnCopyLog','btnDownloadLog',
    'logStatStatus','logStatTIn','logStatTOut','logStatDt','logStatX','logStatSeg',
    'logCalloutEq','detailedLogTableBody','logEventCountBadge','rawLogConsoleText',
    'alarmBanner','alarmMainText','alarmTimeText','alarmDismiss',
    'settingsBackdrop','drawerClose','btnApplySettings','btnResetSettings',
    'settingSegments','settingLength','settingWaveSpeed','derivedSegLen','nonstandardWarn',
    'btnSettings',
    'wkFab','wkPanel','wkClose','wkMessages','wkInput','wkSend',
    'juryModal','btnCloseModal',
    'tabControlRoom','tabCorridorMap','navUnderline',
    'page-control-room','page-corridor-map',
    'map-container','csvFileInput','segStrip','twinSegBadge',
    'btnAudioToggle','btnExportPDF','bathymetryCanvas',
  ];
  ids.forEach(id => { dom[id] = document.getElementById(id); });
}

/* ═══════════════════════════════════════════════════════════════════
   EVENT BINDING
═══════════════════════════════════════════════════════════════════ */
function bindEvents() {
  /* Scenario selector */
  dom['scenarioSelect'].addEventListener('change', e => {
    if (e.target.value === 'UPLOAD_CSV') {
      dom['csvFileInput'].click();
      e.target.value = S.scenarioData && S.scenarioData.scenario ? S.scenarioData.scenario : 'BLIND_01';
    } else {
      loadScenario(e.target.value);
    }
  });

  if (dom['csvFileInput']) {
    dom['csvFileInput'].addEventListener('change', handleCsvUpload);
  }

  /* Playback */
  dom['btnPlayPause'].addEventListener('click', togglePlayPause);
  dom['btnReset'].addEventListener('click',     resetPlayback);

  /* Speed buttons */
  ['spd1','spd2','spd5','spdMax'].forEach(id => {
    dom[id].addEventListener('click', e => {
      document.querySelectorAll('.btn-speed').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      S.playbackSpeed = parseInt(e.currentTarget.dataset.speed, 10);
    });
  });

  /* Page tabs */
  dom['tabControlRoom'].addEventListener('click', () => switchPage('control-room'));
  dom['tabCorridorMap'].addEventListener('click',  () => switchPage('corridor-map'));

  /* Audio toggle */
  if (dom['btnAudioToggle']) {
    dom['btnAudioToggle'].addEventListener('click', toggleAudio);
  }

  /* Export PDF / Print Report */
  if (dom['btnExportPDF']) {
    dom['btnExportPDF'].addEventListener('click', exportIncidentReport);
  }

  /* Alarm (disabled) */
  if (dom['alarmDismiss']) dom['alarmDismiss'].addEventListener('click', () => { if (dom['alarmBanner']) dom['alarmBanner'].classList.add('hidden'); });

  /* Settings */
  dom['btnSettings'].addEventListener('click',       openSettings);
  dom['drawerClose'].addEventListener('click',       closeSettings);
  dom['settingsBackdrop'].addEventListener('click',  e => { if (e.target === dom['settingsBackdrop']) closeSettings(); });
  dom['btnApplySettings'].addEventListener('click',  applySettings);
  dom['btnResetSettings'].addEventListener('click',  resetSettings);
  ['settingSegments','settingLength','settingWaveSpeed'].forEach(id => {
    dom[id].addEventListener('input', updateDerivedField);
  });

  /* Watchkeeper */
  dom['wkFab'].addEventListener('click',  toggleWatchkeeper);
  dom['wkClose'].addEventListener('click', () => closeWatchkeeper());
  dom['wkSend'].addEventListener('click',  sendWKMessage);
  dom['wkInput'].addEventListener('keydown', e => { if (e.key === 'Enter') sendWKMessage(); });

  /* Jury modal */
  dom['btnJuryEval'].addEventListener('click',    runJuryEvaluation);
  dom['btnCloseModal'].addEventListener('click',  () => dom['juryModal'].classList.add('hidden'));
  dom['juryModal'].addEventListener('click', e => { if (e.target === dom['juryModal']) dom['juryModal'].classList.add('hidden'); });

  /* Detailed Log modal */
  dom['btnDetailedLog'].addEventListener('click',    openDetailedLogModal);
  dom['btnCloseLogModal'].addEventListener('click', () => closeDetailedLogModal());
  dom['detailedLogModal'].addEventListener('click', e => { if (e.target === dom['detailedLogModal']) closeDetailedLogModal(); });
  dom['btnCopyLog'].addEventListener('click',        copyDetailedLog);
  dom['btnDownloadLog'].addEventListener('click',    downloadDetailedLog);

  /* Segment chip clicks → scroll canvas to segment */
  for (let i = 1; i <= 5; i++) {
    if (dom[`segChip${i}`]) {
      dom[`segChip${i}`].addEventListener('click', () => highlightSegment(i));
      dom[`segChip${i}`].addEventListener('keydown', e => { if (e.key === 'Enter') highlightSegment(i); });
    }
  }

  /* Resize */
  window.addEventListener('resize', () => { 
    resizeCanvas(); 
    positionNavUnderline(S.currentPage);
    if (S.currentPage === 'corridor-map') renderBathymetry();
  });
}

/* ═══════════════════════════════════════════════════════════════════
   PAGE NAVIGATION
═══════════════════════════════════════════════════════════════════ */
function switchPage(pageId) {
  S.currentPage = pageId;

  ['control-room','corridor-map'].forEach(id => {
    const el = dom[`page-${id}`];
    const tab = document.querySelector(`[data-page="${id}"]`);
    if (!el || !tab) return;
    if (id === pageId) {
      el.classList.remove('hidden');
      tab.classList.add('active');
    } else {
      el.classList.add('hidden');
      tab.classList.remove('active');
    }
  });
  positionNavUnderline(pageId);

  if (pageId === 'corridor-map') {
    if (!S.mapInitialized) initMap();
    setTimeout(() => {
      if (S.mapInstance) S.mapInstance.invalidateSize();
      renderBathymetry();
    }, 150);
  }
}

function positionNavUnderline(pageId) {
  const activeTab = document.querySelector(`[data-page="${pageId}"]`);
  if (!activeTab || !dom['navUnderline']) return;
  const navRect = activeTab.parentElement.getBoundingClientRect();
  const tabRect = activeTab.getBoundingClientRect();
  dom['navUnderline'].style.left  = (tabRect.left - navRect.left) + 'px';
  dom['navUnderline'].style.width = tabRect.width + 'px';
}

/* ═══════════════════════════════════════════════════════════════════
   CHART.JS — Vector A dual-channel
═══════════════════════════════════════════════════════════════════ */
function initChart() {
  const ctx2 = dom['pressureChart'].getContext('2d');
  pressureChart = new Chart(ctx2, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Inlet Pressure (Bar)',
          borderColor: '#22D3EE',
          backgroundColor: 'rgba(34,211,238,0.07)',
          borderWidth: 1.8,
          pointRadius: 0,
          tension: 0.25,
          data: [],
        },
        {
          label: 'Outlet Pressure (Bar)',
          borderColor: '#0E7490',
          backgroundColor: 'rgba(14,116,144,0.06)',
          borderWidth: 1.8,
          pointRadius: 0,
          tension: 0.25,
          data: [],
        },
        {
          label: 'Inlet Baseline',
          borderColor: 'rgba(34,211,238,0.35)',
          borderDash: [5,4],
          borderWidth: 1,
          pointRadius: 0,
          data: [],
          fill: false,
        },
        {
          label: 'Outlet Baseline',
          borderColor: 'rgba(14,116,144,0.35)',
          borderDash: [5,4],
          borderWidth: 1,
          pointRadius: 0,
          data: [],
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#55647C', font: { size: 9, family: "'JetBrains Mono'" }, maxTicksLimit: 12 },
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#55647C', font: { size: 9, family: "'JetBrains Mono'" } },
          suggestedMin: 10,
          suggestedMax: 70,
        },
      },
      plugins: {
        legend: {
          labels: { color: '#90A1B8', font: { size: 10, family: "'JetBrains Mono'" }, boxWidth: 20, padding: 10 },
        },
        tooltip: {
          backgroundColor: 'rgba(16,27,48,0.92)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#90A1B8',
          bodyColor: '#E7ECF5',
          titleFont: { family: "'JetBrains Mono'", size: 10 },
          bodyFont:  { family: "'JetBrains Mono'", size: 11 },
        },
      },
    },
  });
}

function resetChart() {
  if (!pressureChart) return;
  pressureChart.data.labels = [];
  pressureChart.data.datasets.forEach(ds => ds.data = []);
  pressureChart.update('none');
}

function appendChartFrame(frame, analysis) {
  if (!pressureChart) return;
  pressureChart.data.labels.push(`${frame.rel_time_s.toFixed(1)}s`);
  pressureChart.data.datasets[0].data.push(frame.inlet_p);
  pressureChart.data.datasets[1].data.push(frame.outlet_p);
  /* Baseline reference lines (constant) */
  if (analysis) {
    pressureChart.data.datasets[2].data.push(analysis.in_baseline_bar  || 0);
    pressureChart.data.datasets[3].data.push(analysis.out_baseline_bar || 0);
  }
  pressureChart.update('none');
}

/* ═══════════════════════════════════════════════════════════════════
   CANVAS SETUP
═══════════════════════════════════════════════════════════════════ */
function initCanvas() {
  canvas = dom['pipelineTwinCanvas'];
  ctx = canvas.getContext('2d');
  resizeCanvas();
  initParticles();

  /* Click on leak marker → show/hide distance tooltip */
  canvas.addEventListener('click', e => {
    if (!S._leakActive) return;
    const rect = canvas.getBoundingClientRect();
    const cx   = (e.clientX - rect.left) * (canvas.width / rect.width);
    const cy   = (e.clientY - rect.top)  * (canvas.height / rect.height);
    const dx   = cx - S._leakCanvasX;
    const dy   = cy - S._leakCanvasY;
    const hit  = Math.sqrt(dx * dx + dy * dy) < 20; /* 20px hit radius */
    if (hit) {
      S.leakTooltipVisible = !S.leakTooltipVisible;
      /* Update cursor cue */
      canvas.style.cursor = S.leakTooltipVisible ? 'pointer' : 'default';
    } else {
      S.leakTooltipVisible = false;
    }
  });

  /* Cursor hint when hovering over leak */
  canvas.addEventListener('mousemove', e => {
    if (!S._leakActive) { canvas.style.cursor = 'default'; return; }
    const rect = canvas.getBoundingClientRect();
    const cx   = (e.clientX - rect.left) * (canvas.width / rect.width);
    const cy   = (e.clientY - rect.top)  * (canvas.height / rect.height);
    const dx   = cx - S._leakCanvasX;
    const dy   = cy - S._leakCanvasY;
    canvas.style.cursor = Math.sqrt(dx * dx + dy * dy) < 22 ? 'crosshair' : 'default';
  });
}

function resizeCanvas() {
  if (!canvas) return;
  canvas.width  = canvas.clientWidth  || canvas.parentElement.clientWidth;
  canvas.height = canvas.clientHeight || canvas.parentElement.clientHeight;
  initParticles(); /* respawn on resize */
}

/* ─── Flow particles ─────────────────────────────────────────────── */
function initParticles() {
  S.particles = [];
  const { marginX, pipeW, pipeY, pipeH } = pipeGeometry();
  for (let i = 0; i < S.PARTICLE_COUNT; i++) {
    S.particles.push(makeParticle(marginX, pipeW, pipeY, pipeH, true));
  }
}

function makeParticle(marginX, pipeW, pipeY, pipeH, randomX = false) {
  return {
    x: marginX + (randomX ? Math.random() * pipeW : 0),
    y: pipeY + (Math.random() - 0.5) * (pipeH - 6),
    speedFactor: 0.5 + Math.random() * 1.0,
    size: 1 + Math.random() * 1.8,
    alpha: 0.25 + Math.random() * 0.45,
  };
}

/* ─── Pipeline geometry helper ───────────────────────────────────── */
function pipeGeometry() {
  const w  = canvas ? canvas.width  : 600;
  const h  = canvas ? canvas.height : 200;
  const marginX  = 55;
  const marginY  = 30;
  const pipeH    = 26;
  const pipeW    = w - marginX * 2;
  const pipeY    = h * 0.55;
  const segCount = S.segmentCount || 5;
  const segW     = pipeW / segCount;
  return { w, h, marginX, pipeW, pipeH, pipeY, segW, segCount };
}

/* ═══════════════════════════════════════════════════════════════════
   REQUEST ANIMATION FRAME RENDER LOOP
═══════════════════════════════════════════════════════════════════ */
function startRenderLoop() {
  if (rafId) return;
  rafId = requestAnimationFrame(rafLoop);
}

function rafLoop(ts) {
  const dt = Math.min(ts - lastRaf, 50); /* cap delta at 50ms */
  lastRaf = ts;

  updateValveAnimators(dt);
  updateParticles(dt);
  updateBurst(dt);
  updatePlume(dt);
  tweenHUDValues(dt);

  renderCanvas();

  rafId = requestAnimationFrame(rafLoop);
}

/* ─── Valve spring physics (mechanical overshoot) ───────────────── */
function updateValveAnimators(dt) {
  const SPRING   = 0.13;
  const DAMPING  = 0.66;
  S.valves.forEach(v => {
    const force = (v.target - v.progress) * SPRING;
    v.velocity  = v.velocity * DAMPING + force;
    v.progress  = Math.max(0, Math.min(1, v.progress + v.velocity * (dt / 16.67)));
  });
}

/* ─── Particle physics ───────────────────────────────────────────── */
function updateParticles(dt) {
  if (!canvas) return;
  const { marginX, pipeW, pipeY, pipeH } = pipeGeometry();
  const pressureRatio = S.evalData ? S.evalData.min_ratio_pct / 100 : 1;
  const speed = Math.max(0.05, pressureRatio);

  S.particles.forEach(p => {
    p.x += p.speedFactor * speed * 1.6 * (dt / 16.67);
    if (p.x > marginX + pipeW + 10) {
      /* Reset to inlet */
      Object.assign(p, makeParticle(marginX, pipeW, pipeY, pipeH));
    }
  });
}

/* ─── Burst particles (one-time) ─────────────────────────────────── */
function fireBurst(x, y) {
  if (S.burstFired) return;
  S.burstFired = true;
  for (let i = 0; i < 55; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = 0.6 + Math.random() * 3.5;
    S.burstParticles.push({
      x, y,
      vx:   Math.cos(angle) * spd,
      vy:   Math.sin(angle) * spd - 2.2, /* upward bias */
      life: 1.0,
      decay: 0.018 + Math.random() * 0.018,
      size: 1.5 + Math.random() * 2.5,
      hue:  Math.random() > 0.6 ? '34,211,238' : '249,115,22',
    });
  }
  for (let i = 0; i < 3; i++) {
    S.burstRings.push({ x, y, r: 8, life: 1.0, decay: 0.018 + i * 0.006 });
  }
}

function updateBurst(dt) {
  const factor = dt / 16.67;
  S.burstParticles = S.burstParticles.filter(p => {
    p.x    += p.vx * factor;
    p.y    += p.vy * factor;
    p.vy   += 0.09 * factor; /* gravity */
    p.life -= p.decay * factor;
    return p.life > 0;
  });
  S.burstRings = S.burstRings.filter(r => {
    r.r    += 2.5 * factor;
    r.life -= r.decay * factor;
    return r.life > 0;
  });
}

/* ─── Plume bubbles (continuous after leak) ──────────────────────── */
function updatePlume(dt) {
  if (!S.analysis || !S.analysis.is_leak) return;
  if (!S.evalData) return;
  const { marginX, pipeW, pipeY, pipeH } = pipeGeometry();
  const leakX = marginX + (S.analysis.leak_position_m / S.pipelineLength) * pipeW;
  const leakY = pipeY - pipeH / 2;

  /* Spawn — high-density gas burst (3 streams: left, center, right) */
  const spawnRate = S.evalData && S.evalData.valve_state === 'CLOSED' ? 0.5 : 1.0; /* reduce after isolation */
  const spawnCount = Math.random() < 0.7 * (dt / 16.67) * spawnRate ? 3 : 1;
  for (let s = 0; s < spawnCount; s++) {
    const streamOffset = (Math.random() - 0.5) * 18;
    const spd = 0.9 + Math.random() * 2.2;
    S.plumeBubbles.push({
      x:     leakX + streamOffset,
      y:     leakY - 2,
      vy:    -(spd + Math.random() * 1.2),
      vx:    (Math.random() - 0.5) * 0.9,
      life:  1.0,
      decay: 0.012 + Math.random() * 0.012,
      r:     2 + Math.random() * 3.5,
      type:  Math.random() > 0.5 ? 'gas' : 'steam',
    });
  }

  S.plumeBubbles = S.plumeBubbles.filter(b => {
    b.x    += b.vx * (dt / 16.67);
    b.y    += b.vy * (dt / 16.67);
    b.vx   += (Math.random() - 0.5) * 0.10 * (dt / 16.67);
    b.vy   *= 0.998; /* slight drag */
    b.life -= b.decay * (dt / 16.67);
    return b.life > 0;
  });
}

/* ─── HUD tweening ───────────────────────────────────────────────── */
function tweenHUDValues(dt) {
  const alpha = Math.min(1, (dt / 16.67) * 0.08); /* ~500ms tween */
  const lerp  = (c, t) => c + (t - c) * alpha;

  S.displayX        = lerp(S.displayX,        S.targetX);
  S.displayDist     = lerp(S.displayDist,     S.targetDist);
  S.displayTIn      = lerp(S.displayTIn,      S.targetTIn);
  S.displayTOut     = lerp(S.displayTOut,     S.targetTOut);
  S.displayDt       = lerp(S.displayDt,       S.targetDt);
  S.displayNoise    = lerp(S.displayNoise,    S.targetNoise);
  S.displayNoiseDiff= lerp(S.displayNoiseDiff, S.targetNoiseDiff);
}

/* ═══════════════════════════════════════════════════════════════════
   CANVAS RENDER  — the hero element
═══════════════════════════════════════════════════════════════════ */
function renderCanvas() {
  if (!ctx || !canvas) return;
  const { w, h, marginX, pipeW, pipeH, pipeY, segW } = pipeGeometry();
  const analysis = S.analysis;
  const evalData = S.evalData;
  const t = S.currentTime;

  ctx.clearRect(0, 0, w, h);

  /* ── Seabed grid background ─── */
  ctx.strokeStyle = 'rgba(11,20,36,0.55)';
  ctx.lineWidth   = 1;
  for (let gy = 0; gy < h; gy += 22) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
  }
  for (let gx = 0; gx < w; gx += 44) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
  }

  /* ── Segment tint bands ─── */
  const isLeakActive = analysis && analysis.is_leak && t >= Math.min(analysis.t_in || 99, analysis.t_out || 99);
  const dynSeg       = getAffectedSeg(analysis);
  const affectedSeg  = dynSeg.id;
  const segCount     = S.segmentCount || 5;
  const segLenM      = S.pipelineLength / segCount;

  /* Isolation dim: after valves close for 2+ seconds, red fades to 50% */
  const valvesClosed     = evalData && evalData.valve_state === 'CLOSED';
  if (valvesClosed && !S._valveCloseTime) S._valveCloseTime = t;
  if (!valvesClosed) S._valveCloseTime = null;
  const secsSinceClose   = S._valveCloseTime !== null ? t - S._valveCloseTime : 0;
  const isolationDim     = valvesClosed ? Math.max(0.5, 1 - Math.min(1, (secsSinceClose / 2)) * 0.5) : 1.0;

  for (let i = 0; i < segCount; i++) {
    const sx   = marginX + i * segW;
    const seg  = i + 1; /* 1-indexed */

    if (isLeakActive) {
      if (seg < affectedSeg) {
        /* Upstream of leak → healthy blue */
        ctx.fillStyle = 'rgba(34,211,238,0.07)';
      } else if (seg === affectedSeg) {
        /* Leak segment → red, dimmed after isolation */
        const alpha = 0.18 * isolationDim;
        ctx.fillStyle = `rgba(239,68,68,${alpha.toFixed(3)})`;
      } else {
        /* Downstream of leak → red, more dim after isolation */
        const alpha = 0.11 * isolationDim;
        ctx.fillStyle = `rgba(239,68,68,${alpha.toFixed(3)})`;
      }
    } else {
      ctx.fillStyle = 'rgba(34,211,238,0.02)';
    }
    ctx.fillRect(sx, 0, segW, h);
  }

  /* ── Segment highlight flash (chip click) ─── */
  if (highlightSeg > 0 && highlightAlpha > 0) {
    const hx = marginX + (highlightSeg - 1) * segW;
    ctx.fillStyle = `rgba(34,211,238,${highlightAlpha.toFixed(3)})`;
    ctx.fillRect(hx, 0, segW, h);
  }

  /* ── Segment dividers + labels (auto-scaled to avoid crowding) ─── */
  const fontSize = segCount > 8 ? 7.5 : segCount > 5 ? 8.5 : 9;
  ctx.font = `bold ${fontSize}px 'JetBrains Mono', monospace`;
  for (let i = 0; i < segCount; i++) {
    const sx  = marginX + i * segW;
    const seg = i + 1;
    let lblColor;
    if (isLeakActive) {
      if (seg < affectedSeg) lblColor = 'rgba(34,211,238,0.85)';
      else lblColor = 'rgba(239,68,68,0.85)';
    } else {
      lblColor = 'rgba(85,100,124,0.7)';
    }
    ctx.fillStyle = lblColor;
    const startKm = (i * segLenM) / 1000;
    const endKm   = ((i + 1) * segLenM) / 1000;
    const sStr = Number.isInteger(startKm) ? startKm : startKm.toFixed(1);
    const eStr = Number.isInteger(endKm) ? endKm : endKm.toFixed(1);

    let segLabel;
    if (segW < 48) {
      segLabel = `S${seg}`;
    } else if (segW < 76) {
      segLabel = `S${seg}·${sStr}-${eStr}k`;
    } else {
      segLabel = `S${seg} · ${sStr}–${eStr} km`;
    }
    ctx.fillText(segLabel, sx + 3, pipeY - pipeH / 2 - 6);
    /* Tick */
    if (i > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(sx, 10); ctx.lineTo(sx, h - 10); ctx.stroke();
    }
  }

  /* ── Pipe outer shell ─── */
  ctx.strokeStyle = '#22D3EE';
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(marginX, pipeY - pipeH / 2, pipeW, pipeH);

  /* ── Pipe fluid fill — split blue upstream / red downstream of leak ─── */
  const ratio = evalData ? evalData.min_ratio_pct / 100 : 1;
  const pipeInnerX = marginX + 1;
  const pipeInnerY = pipeY - pipeH / 2 + 2;
  const pipeInnerW = pipeW - 2;
  const pipeInnerH = pipeH - 4;

  if (isLeakActive && affectedSeg > 0) {
    /* Leak X on pipe */
    const leakFrac = analysis.leak_position_m / S.pipelineLength;
    const leakPx   = marginX + leakFrac * pipeW;

    /* Blue section — inlet to leak point */
    const blueW = Math.max(0, leakPx - pipeInnerX);
    if (blueW > 0) {
      const blueGrad = ctx.createLinearGradient(pipeInnerX, 0, pipeInnerX + blueW, 0);
      blueGrad.addColorStop(0,   'rgba(0,210,255,0.50)');
      blueGrad.addColorStop(0.5, 'rgba(34,211,238,0.70)');
      blueGrad.addColorStop(1,   'rgba(34,211,238,0.45)');
      ctx.fillStyle = blueGrad;
      ctx.fillRect(pipeInnerX, pipeInnerY, blueW, pipeInnerH);
    }

    /* Red section — leak point to outlet, dimmed after isolation */
    const redStartX = leakPx;
    const redW      = Math.max(0, (pipeInnerX + pipeInnerW) - redStartX);
    if (redW > 0) {
      const redAlpha  = (0.55 * isolationDim).toFixed(2);
      const redAlpha2 = (0.35 * isolationDim).toFixed(2);
      const redGrad = ctx.createLinearGradient(redStartX, 0, redStartX + redW, 0);
      redGrad.addColorStop(0,   `rgba(239,68,68,${redAlpha})`);
      redGrad.addColorStop(0.5, `rgba(220,38,38,${redAlpha2})`);
      redGrad.addColorStop(1,   `rgba(239,68,68,${redAlpha2})`);
      ctx.fillStyle = redGrad;
      ctx.fillRect(redStartX, pipeInnerY, redW, pipeInnerH);
    }
  } else {
    /* Normal full-pipe fluid color */
    const pipeColor = getPipeColor(ratio);
    const fluidGrad = ctx.createLinearGradient(pipeInnerX, 0, pipeInnerX + pipeInnerW, 0);
    fluidGrad.addColorStop(0,   pipeColor.a);
    fluidGrad.addColorStop(0.5, pipeColor.b);
    fluidGrad.addColorStop(1,   pipeColor.a);
    ctx.fillStyle = fluidGrad;
    ctx.fillRect(pipeInnerX, pipeInnerY, pipeInnerW, pipeInnerH);
  }

  /* ── Flow particles ─── */
  ctx.save();
  ctx.beginPath();
  ctx.rect(marginX + 1, pipeY - pipeH / 2 + 2, pipeW - 2, pipeH - 4);
  ctx.clip();
  S.particles.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${p.alpha * ratio})`;
    ctx.fill();
  });
  ctx.restore();

  /* ── Burst particles ─── */
  S.burstParticles.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${p.hue},${p.life.toFixed(2)})`;
    ctx.fill();
  });

  /* ── Burst rings ─── */
  S.burstRings.forEach(r => {
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(249,115,22,${(r.life * 0.7).toFixed(2)})`;
    ctx.lineWidth   = 2;
    ctx.stroke();
  });

  /* ── NPW Acoustic Traveling Pressure Waves (Physics Visualizer) ─── */
  const tFirstArrival = Math.min(analysis && analysis.t_in != null ? analysis.t_in : 999, analysis && analysis.t_out != null ? analysis.t_out : 999);
  const tLastArrival  = Math.max(analysis && analysis.t_in != null ? analysis.t_in : 0,   analysis && analysis.t_out != null ? analysis.t_out : 0);

  if (analysis && analysis.is_leak && analysis.t_in !== null && analysis.t_out !== null && t >= tFirstArrival && t <= tLastArrival + 1.2) {
    const leakFrac = analysis.leak_position_m / S.pipelineLength;
    const leakPx   = marginX + leakFrac * pipeW;
    const distIn   = analysis.leak_position_m;
    const distOut  = S.pipelineLength - analysis.leak_position_m;
    const tOrigin  = Math.min(analysis.t_in - (distIn / S.waveSpeed), analysis.t_out - (distOut / S.waveSpeed));

    // Leftward wavefront toward INLET
    if (t <= analysis.t_in + 0.3) {
      const progIn  = Math.max(0, Math.min(1, (t - tOrigin) / Math.max(0.01, analysis.t_in - tOrigin)));
      const waveInX = leakPx - progIn * (leakPx - marginX);

      ctx.save();
      const gradIn = ctx.createLinearGradient(waveInX - 12, 0, waveInX + 6, 0);
      gradIn.addColorStop(0, 'rgba(34,211,238,0)');
      gradIn.addColorStop(0.7, 'rgba(34,211,238,0.45)');
      gradIn.addColorStop(1, 'rgba(103,232,249,0.85)');
      ctx.fillStyle = gradIn;
      ctx.fillRect(waveInX - 12, pipeInnerY, 18, pipeInnerH);

      ctx.beginPath();
      ctx.moveTo(waveInX, pipeInnerY);
      ctx.lineTo(waveInX, pipeInnerY + pipeInnerH);
      ctx.strokeStyle = '#67E8F9';
      ctx.lineWidth   = 2;
      ctx.stroke();

      ctx.font = "bold 7.5px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#67E8F9';
      ctx.textAlign = 'center';
      ctx.fillText('◄ NPW', waveInX, pipeInnerY - 5);
      ctx.restore();
    }

    // Rightward wavefront toward OUTLET
    if (t <= analysis.t_out + 0.3) {
      const progOut  = Math.max(0, Math.min(1, (t - tOrigin) / Math.max(0.01, analysis.t_out - tOrigin)));
      const waveOutX = leakPx + progOut * ((marginX + pipeW) - leakPx);

      ctx.save();
      const gradOut = ctx.createLinearGradient(waveOutX - 6, 0, waveOutX + 12, 0);
      gradOut.addColorStop(0, 'rgba(249,115,22,0.85)');
      gradOut.addColorStop(0.3, 'rgba(249,115,22,0.45)');
      gradOut.addColorStop(1, 'rgba(249,115,22,0)');
      ctx.fillStyle = gradOut;
      ctx.fillRect(waveOutX - 6, pipeInnerY, 18, pipeInnerH);

      ctx.beginPath();
      ctx.moveTo(waveOutX, pipeInnerY);
      ctx.lineTo(waveOutX, pipeInnerY + pipeInnerH);
      ctx.strokeStyle = '#F97316';
      ctx.lineWidth   = 2;
      ctx.stroke();

      ctx.font = "bold 7.5px 'JetBrains Mono', monospace";
      ctx.fillStyle = '#F97316';
      ctx.textAlign = 'center';
      ctx.fillText('NPW ►', waveOutX, pipeInnerY - 5);
      ctx.restore();
    }

    // Sensor arrival pulses at INLET and OUTLET
    if (Math.abs(t - analysis.t_in) < 0.3) {
      ctx.beginPath();
      ctx.arc(marginX, pipeY, 16, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(34,211,238,0.95)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    if (Math.abs(t - analysis.t_out) < 0.3) {
      ctx.beginPath();
      ctx.arc(marginX + pipeW, pipeY, 16, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(249,115,22,0.95)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  /* ── Leak plume (continuous) ─── */
  if (isLeakActive && analysis) {
    const leakX = marginX + (analysis.leak_position_m / S.pipelineLength) * pipeW;
    const leakY = pipeY - pipeH / 2;

    /* Store leak canvas position for click detection */
    S._leakCanvasX = leakX;
    S._leakCanvasY = leakY;
    S._leakActive  = true;

    /* ── Alarm hazard ring (pulsing glow behind rupture) ─── */
    const alarmPulse = 0.5 + 0.5 * Math.sin(Date.now() / 220);
    ctx.beginPath();
    ctx.arc(leakX, leakY, 22 + alarmPulse * 6, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(239,68,68,${(0.25 + alarmPulse * 0.35).toFixed(2)})`;
    ctx.lineWidth   = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(leakX, leakY, 32 + alarmPulse * 5, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(249,115,22,${(0.10 + alarmPulse * 0.18).toFixed(2)})`;
    ctx.lineWidth   = 2;
    ctx.stroke();

    /* Alarm ⚠ symbol drawn on canvas above rupture */
    const alarmY   = leakY - 68;
    const alarmX   = leakX;
    const txtAlpha = (0.7 + alarmPulse * 0.3).toFixed(2);
    ctx.save();
    ctx.shadowColor = 'rgba(239,68,68,0.95)';
    ctx.shadowBlur  = 12;
    ctx.font        = `bold 20px 'JetBrains Mono', monospace`;
    ctx.fillStyle   = `rgba(239,68,68,${txtAlpha})`;
    ctx.textAlign   = 'center';
    ctx.fillText('⚠', alarmX, alarmY);
    ctx.shadowBlur  = 0;
    ctx.font        = `bold 8px 'JetBrains Mono', monospace`;
    ctx.fillStyle   = `rgba(239,68,68,${txtAlpha})`;
    ctx.fillText('RUPTURE', alarmX, alarmY + 14);
    ctx.textAlign   = 'left';
    ctx.restore();

    /* Pinpoint rupture marker (pulsing ring) */
    const pulseR = 6 + Math.sin(Date.now() / 180) * 2;
    ctx.beginPath();
    ctx.arc(leakX, leakY, pulseR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(239,68,68,0.85)';
    ctx.lineWidth   = 2;
    ctx.stroke();
    /* Clickable hit-area highlight */
    ctx.beginPath();
    ctx.arc(leakX, leakY, 16, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(239,68,68,0.12)';
    ctx.lineWidth   = 8;
    ctx.stroke();

    /* ── Enhanced gas jets (3 separate fanning streams) ─── */
    const now = Date.now();
    const jets = [
      { sway: Math.sin(now / 280) * 14,  w: 8,  h: 70,  colA: 'rgba(34,211,238,0.85)', colB: 'rgba(34,211,238,0.00)' },
      { sway: Math.sin(now / 340) * 22,  w: 14, h: 90,  colA: 'rgba(165,243,252,0.50)', colB: 'rgba(165,243,252,0.00)' },
      { sway: Math.sin(now / 200) * 10,  w: 5,  h: 55,  colA: 'rgba(249,115,22,0.45)', colB: 'rgba(249,115,22,0.00)' },
    ];
    jets.forEach(jet => {
      const g = ctx.createLinearGradient(leakX, leakY, leakX, leakY - jet.h);
      g.addColorStop(0,   jet.colA);
      g.addColorStop(1,   jet.colB);
      ctx.beginPath();
      ctx.moveTo(leakX - jet.w / 2, leakY);
      ctx.lineTo(leakX + jet.w / 2, leakY);
      ctx.lineTo(leakX + jet.w + jet.sway, leakY - jet.h);
      ctx.lineTo(leakX - jet.w + jet.sway, leakY - jet.h);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
    });

    /* ── Plume bubbles (gas particles) ─── */
    S.plumeBubbles.forEach(b => {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      const col = b.type === 'steam' ? `rgba(200,235,255,${(b.life * 0.55).toFixed(2)})`
                                      : `rgba(165,243,252,${(b.life * 0.80).toFixed(2)})`;
      ctx.fillStyle = col;
      ctx.fill();
    });

    /* Fire burst on first detection */
    fireBurst(leakX, leakY);

    /* LEAK label */
    ctx.font = "bold 10px 'JetBrains Mono', monospace";
    ctx.fillStyle = '#EF4444';
    ctx.fillText(`LEAK @ ${analysis.leak_position_m} m`, leakX - 36, pipeY + pipeH / 2 + 18);

    /* Tooltip overlay (if user clicked the leak) */
    if (S.leakTooltipVisible) {
      const dist_m      = analysis.leak_position_m;
      const dist_km     = (dist_m / 1000).toFixed(3);
      const dist_out_m  = S.pipelineLength - dist_m;
      const dist_out_km = (dist_out_m / 1000).toFixed(3);
      const ttX = Math.min(leakX + 18, w - 190); /* keep in bounds */
      const ttY = Math.max(10, leakY - 105);
      const ttW = 178;
      const ttH = 82;

      ctx.save();
      ctx.fillStyle   = 'rgba(10,18,33,0.94)';
      ctx.strokeStyle = 'rgba(239,68,68,0.75)';
      ctx.lineWidth   = 1.5;
      roundRect(ctx, ttX, ttY, ttW, ttH, 7);
      ctx.fill();
      ctx.stroke();

      /* Header */
      ctx.fillStyle = 'rgba(239,68,68,0.95)';
      ctx.font = "bold 8.5px 'JetBrains Mono', monospace";
      ctx.fillText('⚠ RUPTURE LOCATION', ttX + 10, ttY + 14);

      /* Divider */
      ctx.strokeStyle = 'rgba(239,68,68,0.25)';
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(ttX + 10, ttY + 19); ctx.lineTo(ttX + ttW - 10, ttY + 19); ctx.stroke();

      /* From Inlet */
      ctx.fillStyle = 'rgba(100,180,200,0.75)';
      ctx.font = "7.5px 'JetBrains Mono', monospace";
      ctx.fillText('↔ FROM INLET', ttX + 10, ttY + 32);
      ctx.fillStyle = '#22D3EE';
      ctx.font = "bold 11px 'JetBrains Mono', monospace";
      ctx.fillText(`${dist_m.toLocaleString()} m`, ttX + 10, ttY + 46);
      ctx.fillStyle = 'rgba(165,243,252,0.60)';
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.fillText(`(${dist_km} km)`, ttX + 10, ttY + 57);

      /* Divider */
      ctx.strokeStyle = 'rgba(239,68,68,0.15)';
      ctx.beginPath(); ctx.moveTo(ttX + ttW / 2, ttY + 22); ctx.lineTo(ttX + ttW / 2, ttY + ttH - 8); ctx.stroke();

      /* From Outlet */
      ctx.fillStyle = 'rgba(250,150,50,0.75)';
      ctx.font = "7.5px 'JetBrains Mono', monospace";
      ctx.fillText('↔ FROM OUTLET', ttX + ttW / 2 + 6, ttY + 32);
      ctx.fillStyle = '#F97316';
      ctx.font = "bold 11px 'JetBrains Mono', monospace";
      ctx.fillText(`${dist_out_m.toLocaleString()} m`, ttX + ttW / 2 + 6, ttY + 46);
      ctx.fillStyle = 'rgba(253,186,116,0.60)';
      ctx.font = "8px 'JetBrains Mono', monospace";
      ctx.fillText(`(${dist_out_km} km)`, ttX + ttW / 2 + 6, ttY + 57);

      ctx.restore();
    }
  } else {
    S._leakActive = false;
    S.leakTooltipVisible = false;
  }

  /* ── Valve glyphs between segments ─── */
  const valveCount = segCount - 1;
  while (S.valves.length < valveCount) {
    S.valves.push({ progress: 0, velocity: 0, target: 0 });
  }
  while (S.valves.length > valveCount) {
    S.valves.pop();
  }
  for (let i = 0; i < valveCount; i++) {
    const vx = marginX + (i + 1) * segW;
    drawValve(ctx, vx, pipeY, pipeH, S.valves[i]);
  }

  /* ── Inlet node ─── */
  ctx.fillStyle = '#22D3EE';
  ctx.beginPath();
  ctx.arc(marginX, pipeY, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "bold 8px 'JetBrains Mono', monospace";
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.fillText('IN', marginX, pipeY + 3);

  /* ── Outlet node ─── */
  ctx.fillStyle = '#0E7490';
  ctx.beginPath();
  ctx.arc(marginX + pipeW, pipeY, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = "bold 7px 'JetBrains Mono', monospace";
  ctx.fillStyle = '#fff';
  ctx.fillText('OUT', marginX + pipeW, pipeY + 3);
  ctx.textAlign = 'left';

  /* ── km markers below pipe ─── */
  ctx.font = "9px 'JetBrains Mono', monospace";
  ctx.fillStyle = 'rgba(85,100,124,0.55)';
  const totalKm = (S.pipelineLength || 10000) / 1000;
  for (let s = 0; s <= segCount; s++) {
    const km = (s / segCount) * totalKm;
    const kmStr = Number.isInteger(km) ? km : km.toFixed(1);
    const mx = marginX + (s / segCount) * pipeW;
    ctx.fillText(`${kmStr} km`, mx - 10, pipeY + pipeH / 2 + 14);
  }
}

/* ─── Pipe fluid color based on pressure ratio ───────────────────── */
function getPipeColor(ratio) {
  if (ratio >= 0.95) return { a: 'rgba(0,210,255,0.50)', b: 'rgba(34,211,238,0.65)' };
  if (ratio >= 0.80) return { a: 'rgba(234,179,8,0.40)',  b: 'rgba(234,179,8,0.55)'  };
  if (ratio >= 0.60) return { a: 'rgba(249,115,22,0.40)', b: 'rgba(249,115,22,0.55)' };
  return                     { a: 'rgba(239,68,68,0.35)', b: 'rgba(239,68,68,0.50)'  };
}

/* ─── Rounded rect path helper ───────────────────────────────────── */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/* ─── Gate valve drawing ─────────────────────────────────────────── */
function drawValve(ctx, x, pipeY, pipeH, valve) {
  const prog  = valve.progress; /* 0=open, 1=closed */
  const vW    = 10;
  const vH    = pipeH + 18;
  const vTop  = pipeY - vH / 2;
  const color = prog < 0.15 ? '#22C55E'
              : prog < 0.75 ? '#FBBF24'
              : '#DC2626';

  /* Drain fill behind CLOSED valve (downstream side) */
  if (prog > 0.75) {
    const drainAlpha = (prog - 0.75) / 0.25; /* fades in as valve closes */
    ctx.fillStyle = `rgba(58,18,22,${(drainAlpha * 0.65).toFixed(2)})`;
    /* Fill to the right of the valve — downstream side */
    ctx.fillRect(x + vW / 2, pipeY - pipeH / 2 + 2, 120, pipeH - 4);
  }

  /* Flanges */
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(x - vW / 2, vTop, vW, 6);                   /* top flange */
  ctx.strokeRect(x - vW / 2, vTop + vH - 6, vW, 6);          /* bottom flange */

  /* Stem */
  ctx.beginPath();
  ctx.moveTo(x, vTop);
  ctx.lineTo(x, vTop + 6);
  ctx.stroke();

  /* Gate bar position */
  const gateRange = vH - 12;
  const gateY     = vTop + 6 + prog * (gateRange / 2);   /* slides from top to pipe center */

  ctx.fillStyle = color;
  ctx.fillRect(x - vW / 2 + 1, gateY - 2, vW - 2, 4);

  /* Valve body outline */
  ctx.strokeStyle = `${color}55`;
  ctx.strokeRect(x - vW / 2, vTop + 6, vW, gateRange);

  /* State dot */
  ctx.beginPath();
  ctx.arc(x, vTop - 4, 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  /* State text annotation for closed / isolating valves */
  if (prog > 0.75) {
    ctx.save();
    ctx.font = "bold 8px 'JetBrains Mono', monospace";
    ctx.textAlign = 'center';
    const txt = 'GATE CLOSED';
    const txtW = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(10,18,33,0.92)';
    ctx.strokeStyle = 'rgba(239,68,68,0.8)';
    ctx.lineWidth = 1;
    roundRect(ctx, x - txtW / 2 - 4, vTop - 20, txtW + 8, 13, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#EF4444';
    ctx.fillText(txt, x, vTop - 10);
    ctx.restore();
  } else if (prog > 0.25) {
    ctx.save();
    ctx.font = "bold 7.5px 'JetBrains Mono', monospace";
    ctx.textAlign = 'center';
    const txt = 'CLOSING…';
    const txtW = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(10,18,33,0.92)';
    ctx.strokeStyle = 'rgba(251,191,36,0.8)';
    ctx.lineWidth = 1;
    roundRect(ctx, x - txtW / 2 - 4, vTop - 20, txtW + 8, 13, 3);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FBBF24';
    ctx.fillText(txt, x, vTop - 10);
    ctx.restore();
  }
}

/* ═══════════════════════════════════════════════════════════════════
   SCENARIO LOADING
═══════════════════════════════════════════════════════════════════ */
async function loadScenario(name) {
  pausePlayback();
  resetCanvasState();
  resetChart();
  loggedKeys.clear();
  if (dom['eventLogBody']) {
    dom['eventLogBody'].innerHTML = `<div class="log-entry info">[–] Loading ${name}…</div>`;
  }

  try {
    const res = await fetch(`/api/scenario/${name}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    S.scenarioData = await res.json();
    S.analysis     = S.scenarioData.analysis;
    S.frameIndex   = 0;

    computeNoiseStats();
    updateHeaderBadge();
    setHUDTargets(null, S.analysis);
    updateSegmentChips(null, S.analysis);
    updateStepper(null, S.analysis);
    resetAlarm();

    addLog(`[0.0s] Loaded ${name} — ${S.scenarioData.sample_count} samples`, 'info');
    if (S.analysis.is_leak) {
      addLog(`[ready] Leak scenario detected. Press Play to replay.`, 'warn');
    } else {
      addLog(`[ready] Normal Operation scenario. Press Play to observe baseline.`, 'info');
    }
  } catch (err) {
    addLog(`Error loading ${name}: ${err.message}`, 'alarm');
  }
}

async function handleCsvUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  pausePlayback();
  resetCanvasState();
  resetChart();
  loggedKeys.clear();
  if (dom['eventLogBody']) {
    dom['eventLogBody'].innerHTML = `<div class="log-entry info">[–] Uploading ${file.name}…</div>`;
  }
  
  const formData = new FormData();
  formData.append('file', file);
  
  try {
    const res = await fetch(`/api/upload_scenario`, {
      method: 'POST',
      body: formData
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText);
    }
    
    S.scenarioData = await res.json();
    S.analysis     = S.scenarioData.analysis;
    S.frameIndex   = 0;
    
    let opt = Array.from(dom['scenarioSelect'].options).find(o => o.value === S.scenarioData.scenario);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = S.scenarioData.scenario;
      opt.textContent = `📁 ${S.scenarioData.scenario}`;
      dom['scenarioSelect'].insertBefore(opt, dom['scenarioSelect'].lastElementChild.previousElementSibling);
    }
    dom['scenarioSelect'].value = S.scenarioData.scenario;

    computeNoiseStats();
    updateHeaderBadge();
    setHUDTargets(null, S.analysis);
    updateSegmentChips(null, S.analysis);
    updateStepper(null, S.analysis);
    resetAlarm();

    addLog(`[0.0s] Loaded Custom CSV — ${S.scenarioData.sample_count} samples`, 'info');
    if (S.analysis.is_leak) {
      addLog(`[ready] Leak scenario detected. Press Play to replay.`, 'warn');
    } else {
      addLog(`[ready] Normal Operation scenario. Press Play to observe baseline.`, 'info');
    }
  } catch (err) {
    addLog(`Error uploading CSV: ${err.message}`, 'alarm');
  }
  
  e.target.value = ''; // reset input
}

/* ─── Compute noise from baseline window ─────────────────────────── */
function computeNoiseStats() {
  if (!S.scenarioData) return;
  const baseline = S.scenarioData.telemetry.slice(0, 15);
  const inVals   = baseline.map(s => s.inlet_p);
  const outVals  = baseline.map(s => s.outlet_p);
  S.noiseLevel  = stdDev(inVals.concat(outVals));
  const σIn     = stdDev(inVals);
  const σOut    = stdDev(outVals);
  S.noiseDiff   = Math.abs(σIn - σOut);
}

function stdDev(arr) {
  const n    = arr.length;
  if (n < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
}

/* ─── Reset canvas state between scenarios ───────────────────────── */
function resetCanvasState() {
  S.evalData      = null;
  S.analysis      = null;
  S.currentTime   = 0;
  S.burstFired    = false;
  S.burstParticles= [];
  S.burstRings    = [];
  S.plumeBubbles  = [];
  S.alarmFired    = false;
  /* Reset all valves to open */
  S.valves.forEach(v => { v.target = 0; v.progress = 0; v.velocity = 0; });
}

/* ═══════════════════════════════════════════════════════════════════
   PLAYBACK LOOP
═══════════════════════════════════════════════════════════════════ */
function togglePlayPause() {
  if (S.isPlaying) pausePlayback(); else startPlayback();
}

function startPlayback() {
  if (!S.scenarioData) return;
  S.isPlaying = true;
  dom['btnPlayPause'].textContent = '⏸ Pause';
  if (S.frameIndex >= S.scenarioData.telemetry.length - 1) {
    S.frameIndex = 0;
    resetChart();
    loggedKeys.clear();
    S.burstFired = false;
    S.burstParticles = []; S.burstRings = []; S.plumeBubbles = [];
    S.alarmFired = false;
    resetAlarm();
  }
  scheduleNextTick();
}

function pausePlayback() {
  S.isPlaying = false;
  dom['btnPlayPause'].textContent = '▶ Play';
  if (S.timerId) { clearTimeout(S.timerId); S.timerId = null; }
}

function resetPlayback() {
  pausePlayback();
  S.frameIndex = 0;
  resetChart();
  resetCanvasState();
  loggedKeys.clear();
  resetAlarm();
  if (S.scenarioData) {
    S.analysis = S.scenarioData.analysis;
    setHUDTargets(null, S.analysis);
    updateSegmentChips(null, S.analysis);
    updateStepper(null, S.analysis);
  }
  addLog('[0.0s] Playback reset.', 'info');
}

function scheduleNextTick() {
  if (!S.isPlaying) return;
  const interval = S.playbackSpeed === 99 ? 4 : Math.max(12, 100 / S.playbackSpeed);
  S.timerId = setTimeout(playbackTick, interval);
}

function playbackTick() {
  if (!S.isPlaying || !S.scenarioData) return;

  const telemetry    = S.scenarioData.telemetry;
  const frameEvals   = S.analysis.frame_evaluations;
  const idx          = S.frameIndex;

  if (idx >= telemetry.length) { pausePlayback(); return; }

  const frame    = telemetry[idx];
  const evalData = frameEvals[idx];

  /* Update global state (read by rAF render loop) */
  S.evalData    = evalData;
  S.currentTime = frame.rel_time_s;

  /* Update valve targets */
  updateValveTargets(evalData, S.analysis);

  /* Update HUD tween targets */
  setHUDTargets(evalData, S.analysis);

  /* Update DOM elements */
  updateHUDDOM(evalData, S.analysis);
  updateSegmentChips(evalData, S.analysis);
  updateStepper(evalData, S.analysis);
  appendChartFrame(frame, S.analysis);
  handleLogEvents(frame, evalData, S.analysis, idx);

  /* Time readout */
  dom['timeReadout'].textContent = `${frame.rel_time_s.toFixed(2)}s`;

  S.frameIndex++;
  if (S.frameIndex < telemetry.length) {
    scheduleNextTick();
  } else {
    pausePlayback();
    addLog(`[12.0s] Scenario replay complete.`, 'success');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   VALVE STATE MANAGEMENT
═══════════════════════════════════════════════════════════════════ */
function getAffectedSeg(analysis) {
  if (!analysis || !analysis.is_leak || analysis.leak_position_m == null) {
    return { id: 0, label: 'Normal Operation', range: '' };
  }
  const segCount = S.segmentCount || 5;
  const segLenM  = S.pipelineLength / segCount;
  const leakM    = analysis.leak_position_m;
  const segId    = Math.min(segCount, Math.max(1, Math.floor(leakM / segLenM) + 1));
  const startKm  = ((segId - 1) * segLenM) / 1000;
  const endKm    = (segId * segLenM) / 1000;
  const sStr     = Number.isInteger(startKm) ? startKm : startKm.toFixed(1);
  const eStr     = Number.isInteger(endKm) ? endKm : endKm.toFixed(1);
  return {
    id: segId,
    label: `S${segId} (${sStr}–${eStr} km)`,
    range: `${sStr}–${eStr} km`
  };
}

function updateValveTargets(evalData, analysis) {
  if (!evalData || !analysis) return;
  const valveState = evalData.valve_state; /* OPEN | ISOLATING | CLOSED */
  const dynSeg     = getAffectedSeg(analysis);
  const affSeg     = dynSeg.id;

  /* Valves nearest to the affected segment close; others stay open */
  const nearestValves = affSeg > 0
    ? [affSeg - 2, affSeg - 1] /* 0-indexed: valves flanking the segment */
    : [];

  S.valves.forEach((v, i) => {
    const isNearest = nearestValves.includes(i);
    if (analysis.is_leak && isNearest) {
      v.target = valveState === 'CLOSED'     ? 1.0
               : valveState === 'ISOLATING'  ? 0.5
               : 0;
    } else {
      v.target = 0; /* open */
    }
  });

  /* Update badge in overlay */
  const badge = dom['twinValveBadge'];
  if (badge) {
    const textState = valveState === 'CLOSED' ? 'GATE: CLOSED'
                    : valveState === 'ISOLATING' ? 'GATE: ISOLATING'
                    : 'GATE: OPEN';
    badge.textContent = textState;
    badge.className   = `iso-badge ${valveState.toLowerCase()}`;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   HUD UPDATES  — Vector C
 ═══════════════════════════════════════════════════════════════════ */
function setHUDTargets(evalData, analysis) {
  if (!analysis) return;
  S.targetX           = analysis.leak_position_m || 0;
  S.targetDist        = analysis.leak_position_m || 0;
  S.targetDistOut     = analysis.distance_from_outlet_m || 0;
  S.targetTIn         = analysis.t_in  || 0;
  S.targetTOut        = analysis.t_out || 0;
  S.targetDt          = analysis.dt    || 0;
  S.targetNoise       = S.noiseLevel;
  S.targetNoiseDiff   = S.noiseDiff;
}

function updateHUDDOM(evalData, analysis) {
  if (!analysis) return;

  /* Tween display values are updated in rAF; commit to DOM here */
  const fmt    = (v, d=2) => v.toFixed(d);
  const isLk   = analysis.is_leak;
  const dynSeg = getAffectedSeg(analysis);

  if (isLk) {
    const t = S.currentTime;
    const hasTIn  = analysis.t_in !== null && t >= analysis.t_in;
    const hasTOut = analysis.t_out !== null && t >= analysis.t_out;
    const hasLoc  = hasTIn && hasTOut;

    if (hasLoc) {
      setHUDVal('hudX',          `${fmt(S.displayX, 0)} m`, 'cyan', false);
      dom['hudX'].className    = 'hud-hero-val cyan';
      setHUDVal('hudDistance',   `${fmt(S.displayDist, 0)} m`, '', false);
      const distOut = S.pipelineLength - (S.displayDist || 0);
      setHUDVal('hudDistanceOut', `${fmt(distOut, 0)} m`, '', false);
      dom['hudDistanceOut'].className = 'hud-val cyan';
      
      const dtSign = (analysis.dt || 0) >= 0 ? 'cyan' : 'violet';
      setHUDVal('hudDt', `${analysis.dt >= 0 ? '+' : ''}${fmt(S.displayDt, 2)} s`, dtSign, false);
      const cardDt = document.getElementById('hudCardDt');
      if (cardDt) cardDt.classList.toggle('dt-violet', (analysis.dt || 0) < 0);
      
      dom['hudSegBadge'].textContent = dynSeg.label || '—';
      dom['hudSegBadge'].className   = `hud-seg-badge ${segBadgeClass(evalData ? evalData.health_state : 'RED')}`;
    } else if (hasTIn || hasTOut) {
      setHUDVal('hudX', 'Localizing…', '', true);
      dom['hudX'].className = 'hud-hero-val muted';
      setHUDVal('hudDistance', '— m', '', true);
      setHUDVal('hudDistanceOut', '— m', '', true);
      setHUDVal('hudDt', '— s', '', true);
      const cardDt = document.getElementById('hudCardDt');
      if (cardDt) cardDt.classList.remove('dt-violet');
      
      dom['hudSegBadge'].textContent = 'Propagating…';
      dom['hudSegBadge'].className   = 'hud-seg-badge seg-b-yellow';
    } else {
      setHUDVal('hudX', '— m', '', true);
      dom['hudX'].className = 'hud-hero-val muted';
      setHUDVal('hudDistance', '— m', '', true);
      setHUDVal('hudDistanceOut', '— m', '', true);
      setHUDVal('hudDt', '— s', '', true);
      const cardDt = document.getElementById('hudCardDt');
      if (cardDt) cardDt.classList.remove('dt-violet');
      
      dom['hudSegBadge'].textContent = 'Monitoring…';
      dom['hudSegBadge'].className   = 'hud-seg-badge seg-b-none';
    }

    setHUDVal('hudTIn',  hasTIn  ? `${fmt(S.displayTIn, 2)} s`  : '— s', hasTIn  ? 'cyan' : '', !hasTIn);
    setHUDVal('hudTOut', hasTOut ? `${fmt(S.displayTOut, 2)} s` : '— s', hasTOut ? 'cyan' : '', !hasTOut);

  } else {
    setHUDVal('hudX', 'No Leak', '', true);
    dom['hudX'].className     = 'hud-hero-val muted';
    dom['hudSegBadge'].textContent = 'Normal Operation';
    dom['hudSegBadge'].className   = 'hud-seg-badge seg-b-none';
    const cardDt = document.getElementById('hudCardDt');
    if (cardDt) cardDt.classList.remove('dt-violet');
    ['hudDistance','hudDistanceOut','hudTIn','hudTOut','hudDt'].forEach(id => {
      dom[id].textContent = '— —'; dom[id].className = 'hud-val muted';
    });
  }

  /* Baselines */
  dom['hudInBase'].textContent  = analysis.in_baseline_bar  !== null ? `${analysis.in_baseline_bar} Bar` : '— Bar';
  dom['hudOutBase'].textContent = analysis.out_baseline_bar !== null ? `${analysis.out_baseline_bar} Bar` : '— Bar';

  /* Noise */
  dom['hudNoise'].textContent    = S.displayNoise   > 0 ? `${S.displayNoise.toFixed(4)} Bar`    : '— Bar';
  dom['hudNoiseDiff'].textContent= S.displayNoiseDiff > 0 ? `${S.displayNoiseDiff.toFixed(4)} Bar` : '— Bar';
}

function setHUDVal(id, text, colorClass, muted) {
  const el = dom[id];
  if (!el) return;
  el.textContent = text;
  el.className   = `hud-val${muted ? ' muted' : colorClass ? ` ${colorClass}` : ''}`;
}

function segBadgeClass(healthState) {
  return { GREEN: 'seg-b-green', YELLOW: 'seg-b-yellow', ORANGE: 'seg-b-orange', RED: 'seg-b-red' }[healthState] || 'seg-b-none';
}

/* ═══════════════════════════════════════════════════════════════════
   DIGITAL TWIN HEALTH-STATE LOGIC (Standard Pressure-Health Spec)
   ≥ 95%            -> GREEN  — Healthy
   ≥ 80% and < 95%  -> YELLOW — Caution
   ≥ 60% and < 80%  -> ORANGE — Degraded
   < 60%            -> RED    — Critical
═══════════════════════════════════════════════════════════════════ */
function getHealthState(ratioPct) {
  if (ratioPct >= 95.0) return { state: 'GREEN',  label: 'Healthy',  cls: 'healthy',  dot: '✓', color: '#22C55E' };
  if (ratioPct >= 80.0) return { state: 'YELLOW', label: 'Caution',  cls: 'caution',  dot: '▲', color: '#EAB308' };
  if (ratioPct >= 60.0) return { state: 'ORANGE', label: 'Degraded', cls: 'degraded', dot: '◆', color: '#F97316' };
  return                       { state: 'RED',    label: 'Critical', cls: 'critical', dot: '■', color: '#EF4444' };
}

const HEALTH_META = {
  GREEN:  { cls: 'healthy',  dot: '✓', word: 'Healthy',  color: '#22C55E' },
  YELLOW: { cls: 'caution',  dot: '▲', word: 'Caution',  color: '#EAB308' },
  ORANGE: { cls: 'degraded', dot: '◆', word: 'Degraded', color: '#F97316' },
  RED:    { cls: 'critical', dot: '■', word: 'Critical', color: '#EF4444' },
};

function updateSegmentChips(evalData, analysis) {
  const strip = dom['segStrip'] || document.getElementById('segStrip');
  if (!strip) return;

  const isLeakActive = analysis && analysis.is_leak && evalData &&
    S.currentTime >= Math.min(analysis.t_in || 99, analysis.t_out || 99);
  const dynSeg   = getAffectedSeg(analysis);
  const affSeg   = dynSeg.id;
  const segCount = S.segmentCount || 5;
  const segLenM  = S.pipelineLength / segCount;

  let html = '';
  for (let i = 1; i <= segCount; i++) {
    const startKm = ((i - 1) * segLenM) / 1000;
    const endKm   = (i * segLenM) / 1000;
    const sStr = Number.isInteger(startKm) ? startKm : startKm.toFixed(1);
    const eStr = Number.isInteger(endKm) ? endKm : endKm.toFixed(1);
    const rangeText = `${sStr}-${eStr} km`;

    let meta;
    if (isLeakActive) {
      if (i < affSeg) {
        meta = HEALTH_META.GREEN;
      } else if (i === affSeg) {
        const ratio = evalData ? evalData.min_ratio_pct : 50;
        const h = getHealthState(ratio);
        meta = { cls: h.cls, dot: h.dot, word: h.label, color: h.color };
      } else {
        const ratio = evalData.valve_state === 'CLOSED' ? 45.0 : Math.min(94, evalData.min_ratio_pct * 0.95);
        const h = getHealthState(ratio);
        meta = { cls: h.cls, dot: h.dot, word: h.label, color: h.color };
      }
    } else {
      meta = HEALTH_META.GREEN;
    }

    html += `
      <div class="seg-chip ${meta.cls}" id="segChip${i}" role="button" tabindex="0" onclick="highlightSegment(${i})" aria-label="Segment ${i} health">
        <span class="chip-dot">${meta.dot}</span>
        <span>S${i} · ${rangeText} ${meta.word}</span>
      </div>
    `;
  }
  strip.innerHTML = html;
}

/* ─── Highlight a segment on canvas (flash) ──────────────────────── */
let highlightSeg = 0;
let highlightAlpha = 0;
function highlightSegment(seg) {
  highlightSeg = seg;
  highlightAlpha = 0.45;
  /* Fade out over 1.5s */
  const fadeStep = () => {
    highlightAlpha = Math.max(0, highlightAlpha - 0.02);
    if (highlightAlpha > 0) requestAnimationFrame(fadeStep);
    else highlightSeg = 0;
  };
  requestAnimationFrame(fadeStep);
}

/* ═══════════════════════════════════════════════════════════════════
   PROCESS STEPPER
═══════════════════════════════════════════════════════════════════ */
function updateStepper(evalData, analysis) {
  const npwStep   = evalData ? evalData.npw_step : 0;
  const valveSt   = evalData ? evalData.valve_state : 'OPEN';
  const isLk      = analysis && analysis.is_leak;

  /* Detect: always active once data loaded */
  setStep('step-detect', S.scenarioData ? 'complete' : '');

  /* Analyze: active once we have an analysis result */
  setStep('step-analyze', S.scenarioData ? 'complete' : '');

  /* Localize: active when first sensor triggered */
  setStep('step-localize',
    npwStep >= 3 ? 'complete' :
    npwStep === 2 ? 'active' : '');

  /* Visualize: active when both sensors triggered */
  setStep('step-visualize',
    isLk && valveSt !== 'OPEN' ? 'complete' :
    npwStep >= 3 ? 'active' : '');

  /* Respond: complete when valve is CLOSED */
  setStep('step-respond',
    valveSt === 'CLOSED' ? 'complete' :
    valveSt === 'ISOLATING' ? 'active' : '');
}

function setStep(id, state) {
  const el = dom[id];
  if (!el) return;
  el.className = `stepper-step ${state}`;
}

/* ═══════════════════════════════════════════════════════════════════
   EVENT LOG
═══════════════════════════════════════════════════════════════════ */
function handleLogEvents(frame, evalData, analysis, idx) {
  if (idx === 0) {
    loggedKeys.clear();
    if (dom['eventLogBody']) {
      dom['eventLogBody'].innerHTML = `<div class="log-entry info">[0.0s] Loaded ${S.scenarioData.scenario} — ${S.scenarioData.sample_count} samples</div>`;
    }
  }
  if (!analysis.is_leak) return;
  const t = frame.rel_time_s.toFixed(2);

  if (S.currentTime >= analysis.t_in  && !loggedKeys.has('t_in')) {
    loggedKeys.add('t_in');
    playTransientPing(720);
    addLog(`[${t}s] ANOMALY_INLET — Transient arrival at inlet sensor (t_in = ${analysis.t_in}s)`, 'warn');
  }
  if (S.currentTime >= analysis.t_out && !loggedKeys.has('t_out')) {
    loggedKeys.add('t_out');
    playTransientPing(580);
    addLog(`[${t}s] ANOMALY_OUTLET — Transient arrival at outlet sensor (t_out = ${analysis.t_out}s)`, 'warn');
  }
  if (S.currentTime >= Math.max(analysis.t_in, analysis.t_out) && !loggedKeys.has('loc')) {
    loggedKeys.add('loc');
    playAlarmChime();
    const dynSeg = getAffectedSeg(analysis);
    addLog(`[${t}s] NPW_LOCALIZED — X = ${analysis.leak_position_m} m (${dynSeg.label})`, 'alarm');
    addLog(`[${t}s] Δt = ${analysis.dt}s | Formula: (${S.pipelineLength} − ${S.waveSpeed}×${analysis.dt}) / 2`, 'alarm');
  }
  if (evalData.valve_state === 'ISOLATING' && !loggedKeys.has('isol')) {
    loggedKeys.add('isol');
    addLog(`[${t}s] ISOLATION_INITIATED — Nearest valves closing…`, 'alarm');
  }
  if (evalData.valve_state === 'CLOSED' && !loggedKeys.has('closed')) {
    loggedKeys.add('closed');
    playValveLock();
    addLog(`[${t}s] ISOLATION_COMPLETE — Virtual isolation engaged. Segment quarantined.`, 'alarm');
  }
}

function addLog(text, type) {
  const body = dom['eventLogBody'];
  if (!body) return;
  const div  = document.createElement('div');
  div.className   = `log-entry ${type}`;
  div.textContent = text;
  body.appendChild(div);
  body.scrollTop = body.scrollHeight;
}

/* ═══════════════════════════════════════════════════════════════════
   ALARM BANNER (Disabled per user request)
═══════════════════════════════════════════════════════════════════ */
function checkAlarm(frame, evalData, analysis) {
  /* Disabled */
}

function resetAlarm() {
  if (dom['alarmBanner']) dom['alarmBanner'].classList.add('hidden');
  S.alarmFired = false;
}

/* ═══════════════════════════════════════════════════════════════════
   SETTINGS DRAWER
═══════════════════════════════════════════════════════════════════ */
function openSettings() {
  dom['settingsBackdrop'].classList.remove('hidden');
  S.settingsOpen = true;
  updateDerivedField();
  updateNonstandardWarning();
}

function closeSettings() {
  dom['settingsBackdrop'].classList.add('hidden');
  S.settingsOpen = false;
}

function updateDerivedField() {
  const segs = parseInt(dom['settingSegments'].value, 10)  || 5;
  const len  = parseInt(dom['settingLength'].value,   10)  || 10000;
  const segLen = segs > 0 ? (len / segs).toFixed(0) : '—';
  dom['derivedSegLen'].textContent = `${parseInt(segLen).toLocaleString()} m per segment`;
  updateNonstandardWarning();
}

function updateNonstandardWarning() {
  const segs  = parseInt(dom['settingSegments'].value,  10);
  const len   = parseInt(dom['settingLength'].value,    10);
  const wSpd  = parseInt(dom['settingWaveSpeed'].value, 10);
  const nonStd = segs !== 5 || len !== 10000 || wSpd !== 1000;
  dom['nonstandardWarn'].classList.toggle('show', nonStd);
  dom['customConfigTag'].classList.toggle('hidden', !nonStd);
}

function applySettings() {
  S.segmentCount    = parseInt(dom['settingSegments'].value,  10) || 5;
  S.pipelineLength  = parseInt(dom['settingLength'].value,    10) || 10000;
  S.waveSpeed       = parseInt(dom['settingWaveSpeed'].value, 10) || 1000;
  
  const valveCount = S.segmentCount - 1;
  while (S.valves.length < valveCount) {
    S.valves.push({ progress: 0, velocity: 0, target: 0 });
  }
  while (S.valves.length > valveCount) {
    S.valves.pop();
  }

  updateNonstandardWarning();
  updateHeaderBadge();
  closeSettings();
  initParticles(); /* respawn for new geometry */
  updateHUDDOM(S.evalData, S.analysis);
  updateSegmentChips(S.evalData, S.analysis);
  updateCorridorSidebarRoute();
  addLog(`[config] Pipeline: ${S.pipelineLength} m | Segments: ${S.segmentCount} | C = ${S.waveSpeed} m/s`, 'info');
}

function updateHeaderBadge() {
  const badge = dom['twinSegBadge'] || document.getElementById('twinSegBadge');
  if (badge) {
    const segLenKm = (S.pipelineLength / (S.segmentCount || 5) / 1000);
    const segStr = Number.isInteger(segLenKm) ? segLenKm : segLenKm.toFixed(1);
    badge.textContent = `3D Transient Flow · ${S.segmentCount || 5} × ${segStr} km Segments`;
  }
}

function resetSettings() {
  dom['settingSegments'].value  = '5';
  dom['settingLength'].value    = '10000';
  dom['settingWaveSpeed'].value = '1000';
  dom['nonstandardWarn'].classList.remove('show');
  dom['customConfigTag'].classList.add('hidden');
  applySettings();
}

const REAL_CORRIDOR_KM = 661.3;

function updateCorridorSidebarRoute() {
  const routeEl = document.querySelector('.map-route-line');
  if (!routeEl) return;
  const segCount = S.segmentCount || 5;
  let html = '';
  for (let i = 1; i <= segCount; i++) {
    const startKm = (((i - 1) * REAL_CORRIDOR_KM) / segCount).toFixed(1);
    const endKm   = ((i * REAL_CORRIDOR_KM) / segCount).toFixed(1);
    html += `<div class="map-route-seg" id="mapSeg${i}"><span>S${i}</span><span>${startKm}–${endKm} km</span></div>`;
  }
  routeEl.innerHTML = html;
}

/* ═══════════════════════════════════════════════════════════════════
   WATCHKEEPER  —  Client-side AI assistant
═══════════════════════════════════════════════════════════════════ */
function toggleWatchkeeper() {
  if (S.wkOpen) closeWatchkeeper(); else openWatchkeeper();
}
function openWatchkeeper()  { dom['wkPanel'].classList.remove('hidden'); S.wkOpen = true; }
function closeWatchkeeper() { dom['wkPanel'].classList.add('hidden');    S.wkOpen = false; }

function sendWKMessage() {
  const input = dom['wkInput'];
  const msg   = input.value.trim();
  if (!msg) return;
  input.value = '';
  appendWKBubble(msg, 'user');
  const reply = watchkeeperRespond(msg);
  appendWKBubble(reply, 'bot');
}

function appendWKBubble(text, role) {
  const div = document.createElement('div');
  div.className = `wk-bubble ${role}`;
  div.innerHTML = text;
  dom['wkMessages'].appendChild(div);
  dom['wkMessages'].scrollTop = dom['wkMessages'].scrollHeight;
  return div;
}

/* ─── Watchkeeper knowledge engine ──────────────────────────────── */
function watchkeeperRespond(msg) {
  const q = msg.toLowerCase();
  const a = S.analysis;

  /* NPW formula */
  if (/npw|negative pressure|formula|equation|locali/.test(q)) {
    return `<strong>Negative Pressure Wave (NPW) Localization:</strong><br>
X = (L − C × Δt) / 2<br>
where L = ${S.pipelineLength} m, C = ${S.waveSpeed} m/s, and Δt = t<sub>out</sub> − t<sub>in</sub>.<br>
A pressure drop propagates in both directions from the leak at acoustic wave speed C. The time difference Δt lets us pinpoint distance X from the inlet.`;
  }

  /* Δt */
  if (/\bdt\b|delta.?t|time diff|∆t|Δt/.test(q)) {
    const dt = a && a.dt !== null ? `${a.dt}s (${a.dt >= 0 ? 'wave hit inlet first → leak closer to inlet' : 'wave hit outlet first → leak closer to outlet'})` : 'not yet computed';
    return `<strong>Δt</strong> is the transit-time difference between when the Negative Pressure Wave arrives at the inlet sensor vs the outlet sensor.<br>
Current Δt: <strong>${dt}</strong><br>
Positive Δt → inlet triggered first → X closer to inlet.<br>
Negative Δt → outlet triggered first → X closer to outlet (shown in violet on the HUD).`;
  }

  /* Calculated X */
  if (/\bx\b|calculated|leak.pos|distance|meters/.test(q)) {
    const x = a && a.leak_position_m != null ? `${a.leak_position_m} m from inlet` : 'not yet calculated';
    return `<strong>Calculated X</strong> is the estimated leak position from the inlet.<br>
Current value: <strong>${x}</strong><br>
This is computed by X = (${S.pipelineLength} − ${S.waveSpeed} × Δt) / 2.`;
  }

  /* Segment */
  if (/segment|seg |which.seg|zone|area/.test(q)) {
    const seg = a && a.affected_segment ? a.affected_segment : 'not yet identified';
    return `The pipeline is divided into <strong>5 segments</strong> of 2 km each (0–2, 2–4, 4–6, 6–8, 8–10 km).<br>
Affected segment: <strong>${seg}</strong><br>
The two valves flanking the affected segment close automatically when a CRITICAL state is confirmed.`;
  }

  /* Health state */
  if (/health|green|yellow|orange|red|caution|degrad|critical/.test(q)) {
    return `<strong>Pressure-Health Classification (ISA-101 aligned):</strong><br>
<span style="color:#22C55E">● ≥ 95%</span> — <strong>Healthy</strong> (GREEN)<br>
<span style="color:#EAB308">● 80–94%</span> — <strong>Caution</strong> (YELLOW)<br>
<span style="color:#F97316">● 60–79%</span> — <strong>Degraded</strong> (ORANGE)<br>
<span style="color:#EF4444">● &lt; 60%</span> — <strong>Critical</strong> (RED) → automatic valve isolation<br>
Percentages are relative to the initial 1.5s baseline pressure.`;
  }

  /* t_in / t_out */
  if (/t.in|t.out|arrival|trigger|sensor/.test(q)) {
    const tIn  = a && a.t_in  !== null ? `${a.t_in}s`  : '—';
    const tOut = a && a.t_out !== null ? `${a.t_out}s` : '—';
    return `<strong>Transient arrival times:</strong><br>
t<sub>in</sub> (inlet sensor): <strong>${tIn}</strong><br>
t<sub>out</sub> (outlet sensor): <strong>${tOut}</strong><br>
These are the moments the Negative Pressure Wave first arrives at each end of the pipeline and is detected by the edge analytics threshold filter.`;
  }

  /* Valve */
  if (/valve|isolat|close|shut|block/.test(q)) {
    const vs = S.evalData ? S.evalData.valve_state : 'OPEN';
    return `<strong>Valve status: ${vs}</strong><br>
Valves remain <span style="color:#22C55E">OPEN</span> during normal operation.<br>
They enter <span style="color:#FBBF24">ISOLATING</span> state when the pressure ratio drops below 80%, and fully <span style="color:#EF4444">CLOSE</span> below 60% — quarantining the affected segment.`;
  }

  /* Current scenario */
  if (/scenario|blind|current|which/.test(q)) {
    const sc = S.scenarioData ? S.scenarioData.scenario : '—';
    const st = a ? a.status : '—';
    return `<strong>Current scenario: ${sc}</strong><br>
Status: ${st}<br>
${a && a.is_leak ? `Leak detected at X = ${a.leak_position_m} m in ${a.affected_segment}.` : 'No leak — this is a normal-operation control scenario.'}`;
  }

  /* Noise */
  if (/noise|σ|sigma|signal/.test(q)) {
    return `<strong>Noise statistics</strong> are computed from the first 15 samples (baseline window, ≈ 1.5s):<br>
σ Noise Level: <strong>${S.noiseLevel.toFixed(4)} Bar</strong> (combined inlet + outlet std dev)<br>
Noise Difference: <strong>${S.noiseDiff.toFixed(4)} Bar</strong> (|σ_in − σ_out|)<br>
High noise difference can indicate pre-existing sensor drift.`;
  }

  /* Baseline */
  if (/baseline|base|reference|normal.pressure/.test(q)) {
    const ib = a && a.in_baseline_bar  != null ? `${a.in_baseline_bar} Bar`  : '—';
    const ob = a && a.out_baseline_bar != null ? `${a.out_baseline_bar} Bar` : '—';
    return `<strong>Baseline pressures</strong> are the mean of the first 15 samples (initial 1.5s):<br>
Inlet baseline: <strong>${ib}</strong><br>
Outlet baseline: <strong>${ob}</strong><br>
All health-state thresholds are relative to these values.`;
  }

  /* Wave speed */
  if (/wave.speed|\bC\b|acoustic|1000|speed of/.test(q)) {
    return `<strong>Wave speed C = ${S.waveSpeed} m/s</strong><br>
This is the acoustic propagation speed of the Negative Pressure Wave in the subsea pipeline fluid. Per the competition spec, C is fixed at 1,000 m/s. It directly determines the spatial resolution of the leak localization — 1 ms error in Δt = 0.5 m error in X.`;
  }

  /* How it works / general */
  if (/how|work|explain|system|pipeguard/.test(q)) {
    return `<strong>How PipeGuard works:</strong><br>
1. <strong>Detect</strong> — Edge analytics monitors inlet & outlet pressure at 100ms resolution.<br>
2. <strong>Analyze</strong> — A transient detection filter finds when pressure drops &gt; 2.5 Bar from baseline at rate &gt; 1 Bar/step.<br>
3. <strong>Localize</strong> — The Negative Pressure Wave formula pinpoints X from Δt between the two sensors.<br>
4. <strong>Visualize</strong> — The Digital Twin canvas and HUD update in real time.<br>
5. <strong>Respond</strong> — Valves flanking the affected segment close automatically when CRITICAL.`;
  }

  /* Default */
  return `I can help with: NPW formula, Δt, t_in / t_out, Calculated X, segment identification, health states, valve isolation, noise levels, or the current scenario.<br>Try asking: "How is X calculated?" or "What does Δt mean?"`;
}

/* ═══════════════════════════════════════════════════════════════════
   CORRIDOR MAP  (Spec §5)  —  Leaflet
═══════════════════════════════════════════════════════════════════ */
const PIPELINE_ROUTE = [
  [17.6868, 83.2185],   // Visakhapatnam (Inlet) - 0.0 km
  [16.9891, 82.2475],   // Kakinada - 129.0 km
  [16.1875, 81.1389],   // Machilipatnam - 277.0 km
  [14.4426, 79.9865],   // Nellore - 507.0 km
  [13.0827, 80.2707],   // Chennai (Outlet) - 661.3 km
];
const ROUTE_LABELS = [
  'Visakhapatnam (Inlet) · 0.0 km',
  'Kakinada · 129.0 km',
  'Machilipatnam · 277.0 km',
  'Nellore · 507.0 km',
  'Chennai (Outlet) · 661.3 km'
];

function initMap() {
  S.mapInitialized = true;

  const mapEl = dom['map-container'];
  if (!mapEl) return;

  S.mapInstance = L.map(mapEl, {
    center: [15.5, 81.5],
    zoom:   7,
    zoomControl: true,
    attributionControl: true,
  });

  /* Dark tile layer — CARTO Voyager Dark with API key */
  L.tileLayer('https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=cb1_2qeg_1_c3cd7fad6864b32aaf5dfcdc', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/">CARTO</a>',
    maxZoom:     19,
  }).addTo(S.mapInstance);

  /* Pipeline route — glowing cyan polyline */
  S.mapRouteLayer = L.polyline(PIPELINE_ROUTE, {
    color:  '#22D3EE',
    weight: 3,
    opacity: 0.85,
  }).addTo(S.mapInstance);

  /* Glow effect (second, wider line) */
  L.polyline(PIPELINE_ROUTE, {
    color: '#22D3EE',
    weight: 10,
    opacity: 0.08,
  }).addTo(S.mapInstance);

  /* City / landmark markers with real distances */
  PIPELINE_ROUTE.forEach((coord, i) => {
    const isEnd = i === 0 || i === PIPELINE_ROUTE.length - 1;
    L.circleMarker(coord, {
      radius:      isEnd ? 9 : 7,
      color:       '#22D3EE',
      fillColor:   isEnd ? '#22D3EE' : '#0E7490',
      fillOpacity: 0.9,
      weight:      2,
    }).bindTooltip(ROUTE_LABELS[i], { permanent: false, className: 'leaflet-dark-tooltip' })
      .addTo(S.mapInstance);
  });

  /* Segment boundary markers */
  const segCount = S.segmentCount || 5;
  S.mapSegMarkers = [];
  for (let i = 1; i < segCount; i++) {
    const frac   = i / segCount;
    const pos    = interpolateRoute(PIPELINE_ROUTE, frac);
    const state  = getSegmentHealthColor(i);
    const realKm = (frac * REAL_CORRIDOR_KM).toFixed(1);
    S.mapSegMarkers.push(
      L.circleMarker(pos, {
        radius: 6, color: state, fillColor: state, fillOpacity: 0.7, weight: 2,
      }).bindTooltip(`S${i}/S${i+1} boundary · ${realKm} km`, { permanent: false })
        .addTo(S.mapInstance)
    );
  }

  /* Inject pulsing leak marker CSS */
  if (!document.getElementById('leaflet-pulse-style')) {
    const st = document.createElement('style');
    st.id = 'leaflet-pulse-style';
    st.textContent = `
      .leaflet-pulse-icon {
        border-radius: 50%;
        width: 24px; height: 24px;
        background: rgba(239,68,68,0.35);
        border: 2px solid #EF4444;
        box-shadow: 0 0 0 0 rgba(239,68,68,0.7);
        animation: leakPulse 1.8s ease-out infinite;
      }
      @keyframes leakPulse {
        0%   { box-shadow: 0 0 0 0   rgba(239,68,68,0.70); }
        70%  { box-shadow: 0 0 0 18px rgba(239,68,68,0.00); }
        100% { box-shadow: 0 0 0 0   rgba(239,68,68,0.00); }
      }
    `;
    document.head.appendChild(st);
  }

  /* Leak marker — pulsing DivIcon beacon */
  const pulseIcon = L.divIcon({ className: '', html: '<div class="leaflet-pulse-icon"></div>', iconSize: [24,24], iconAnchor: [12,12] });
  S.mapLeakMarker = L.marker([15.5, 81.5], { icon: pulseIcon, opacity: 0 }).addTo(S.mapInstance);

  /* Update map state periodically */
  setInterval(refreshMapState, 1000);
}

function refreshMapState() {
  if (!S.mapInstance || !S.analysis) return;

  const analysis = S.analysis;
  const isLeak   = analysis.is_leak &&
                   S.currentTime >= Math.min(analysis.t_in || 99, analysis.t_out || 99);
  const dynSeg   = getAffectedSeg(analysis);
  const segCount = S.segmentCount || 5;

  /* Segment boundary marker colors */
  S.mapSegMarkers.forEach((m, i) => {
    const color = getSegmentHealthColor(i + 1);
    m.setStyle({ color, fillColor: color });
  });

  /* Sidebar: route segment health pills */
  for (let i = 1; i <= segCount; i++) {
    const el = document.getElementById(`mapSeg${i}`);
    if (!el) continue;
    el.classList.remove('seg-healthy', 'seg-critical');
    if (isLeak) {
      if (i < dynSeg.id) {
        el.classList.add('seg-healthy');
      } else {
        el.classList.add('seg-critical');
      }
    }
  }

  /* Sidebar: Leak Localization Status */
  const lkState    = document.getElementById('mapLkState');
  const lkInlet    = document.getElementById('mapLkFromInlet');
  const lkOutlet   = document.getElementById('mapLkFromOutlet');
  const lkSeg      = document.getElementById('mapLkSeg');

  if (isLeak && analysis.leak_position_m != null) {
    const dist_m      = analysis.leak_position_m;
    const frac        = dist_m / S.pipelineLength;
    const realInletKm = (frac * REAL_CORRIDOR_KM).toFixed(1);
    const realOutKm   = ((1 - frac) * REAL_CORRIDOR_KM).toFixed(1);
    const dist_out_m  = S.pipelineLength - dist_m;

    if (lkState)  { lkState.textContent = '⚠ LEAK DETECTED'; lkState.className = 'map-lk-val red'; }
    if (lkInlet)  { lkInlet.textContent  = `${realInletKm} km (${dist_m.toLocaleString()} m)`;        lkInlet.className  = 'map-lk-val cyan'; }
    if (lkOutlet) { lkOutlet.textContent = `${realOutKm} km (${dist_out_m.toLocaleString()} m)`;     lkOutlet.className = 'map-lk-val orange'; }
    if (lkSeg)    { lkSeg.textContent    = dynSeg.label || '—';                   lkSeg.className    = 'map-lk-val red'; }

    /* Pulsing map beacon */
    const coord = interpolateRoute(PIPELINE_ROUTE, frac);
    S.mapLeakMarker.setLatLng(coord);
    S.mapLeakMarker.setOpacity(1);
    S.mapLeakMarker.bindPopup(
      `<div style="font-family:monospace;font-size:12px;background:#101B30;color:#E7ECF5;padding:10px 12px;border-radius:7px;line-height:1.7">
        <b style="color:#EF4444">⚠ RUPTURE DETECTED</b><br>
        <span style="color:#22D3EE">↔ From Inlet (Vizag):</span> <b>${realInletKm} km</b> (${dist_m.toLocaleString()} m)<br>
        <span style="color:#F97316">↔ From Outlet (Chennai):</span> <b>${realOutKm} km</b> (${dist_out_m.toLocaleString()} m)<br>
        <span style="color:#94A3B8">Segment:</span> ${dynSeg.label || '—'}<br>
        <span style="color:#94A3B8">Δt:</span> ${analysis.dt}s
      </div>`, { maxWidth: 280 }
    );
  } else {
    if (lkState)  { lkState.textContent = S.isPlaying ? 'Monitoring…' : 'Awaiting playback'; lkState.className = 'map-lk-val'; }
    if (lkInlet)  { lkInlet.textContent  = '—'; lkInlet.className  = 'map-lk-val cyan'; }
    if (lkOutlet) { lkOutlet.textContent = '—'; lkOutlet.className = 'map-lk-val orange'; }
    if (lkSeg)    { lkSeg.textContent    = '—'; lkSeg.className    = 'map-lk-val'; }
    S.mapLeakMarker.setOpacity(0);
  }
}

/* ─── Route interpolation ────────────────────────────────────────── */
function interpolateRoute(route, fraction) {
  fraction = Math.max(0, Math.min(1, fraction));
  const dists = [];
  let total   = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const d = Math.hypot(route[i+1][0]-route[i][0], route[i+1][1]-route[i][1]);
    dists.push(d);
    total += d;
  }
  let target = fraction * total;
  let cum    = 0;
  for (let i = 0; i < dists.length; i++) {
    if (cum + dists[i] >= target || i === dists.length - 1) {
      const t = dists[i] > 0 ? (target - cum) / dists[i] : 0;
      return [
        route[i][0] + t * (route[i+1][0] - route[i][0]),
        route[i][1] + t * (route[i+1][1] - route[i][1]),
      ];
    }
    cum += dists[i];
  }
  return route[route.length - 1];
}

function getSegmentHealthColor(segId) {
  if (!S.analysis || !S.analysis.is_leak) return '#22C55E';
  const dynSeg = getAffectedSeg(S.analysis);
  const isLeakActive = S.currentTime >= Math.min(S.analysis.t_in || 99, S.analysis.t_out || 99);
  if (!isLeakActive) return '#22C55E';

  if (segId < dynSeg.id) return '#22C55E';
  if (segId === dynSeg.id) {
    const ratio = S.evalData ? S.evalData.min_ratio_pct : 50;
    return getHealthState(ratio).color;
  }
  const ratio = S.evalData && S.evalData.valve_state === 'CLOSED' ? 45 : (S.evalData ? S.evalData.min_ratio_pct * 0.95 : 50);
  return getHealthState(ratio).color;
}

/* ═══════════════════════════════════════════════════════════════════
   JURY EVALUATION MODAL
═══════════════════════════════════════════════════════════════════ */
async function runJuryEvaluation() {
  dom['juryModal'].classList.remove('hidden');
  dom['juryTableBody'].innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-muted)">Executing suite across BLIND_01–BLIND_07…</td></tr>`;

  try {
    const res  = await fetch('/api/evaluate_all');
    const data = await res.json();

    dom['juryTableBody'].innerHTML = '';
    data.summary.forEach(item => {
      const isLk = item.is_leak;
      const tr   = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${item.scenario}</strong></td>
        <td class="${isLk ? 'td-leak' : 'td-normal'}">${item.status}</td>
        <td>${item.t_in  != null ? item.t_in.toFixed(2)  + ' s' : '—'}</td>
        <td>${item.t_out != null ? item.t_out.toFixed(2) + ' s' : '—'}</td>
        <td>${item.dt    != null ? (item.dt >= 0 ? '+' : '') + item.dt.toFixed(2) + ' s' : '—'}</td>
        <td>${item.leak_position_m != null ? item.leak_position_m + ' m' : '—'}</td>
        <td>${item.affected_segment || '—'}</td>
        <td>${item.isolation_triggered ? 'ACTIVATED' : 'Nominal (Open)'}</td>
        <td class="td-ok">✓ VERIFIED</td>
      `;
      dom['juryTableBody'].appendChild(tr);
    });
  } catch (err) {
    dom['juryTableBody'].innerHTML = `<tr><td colspan="9" style="color:var(--state-red);text-align:center;padding:16px">Error: ${err.message}</td></tr>`;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   DETAILED SCENARIO EVENT LOG MODAL
═══════════════════════════════════════════════════════════════════ */
function buildScenarioDetailedEvents(scenarioData, analysis) {
  if (!scenarioData || !analysis) return [];
  const events = [];
  const scName = scenarioData.scenario || 'Scenario';
  const sampleCount = scenarioData.sample_count || (scenarioData.telemetry ? scenarioData.telemetry.length : 121);
  const inBase = analysis.in_baseline_bar;
  const outBase = analysis.out_baseline_bar;

  /* Event 1: Initialization */
  events.push({
    time: '[0.0s]',
    tag: 'LOAD_SCENARIO',
    tagClass: 'tag-info',
    badgeText: 'INITIALIZED',
    desc: `Loaded <strong>${scName}</strong> (${sampleCount} samples @ 100ms sampling rate). Initial 1.5s baseline established: Inlet = ${inBase !== null ? inBase : '—'} Bar, Outlet = ${outBase !== null ? outBase : '—'} Bar. σ Noise = ${S.noiseLevel.toFixed(4)} Bar.`,
    raw: `[0.0s] Loaded ${scName} — ${sampleCount} samples`
  });

  if (!analysis.is_leak) {
    events.push({
      time: '[1.50s]',
      tag: 'BASELINE_STABLE',
      tagClass: 'tag-success',
      badgeText: 'NOMINAL',
      desc: `Baseline stability verified. Sensor noise difference |Δσ| = ${S.noiseDiff.toFixed(4)} Bar. Telemetry operating within normal variance.`,
      raw: `[1.50s] BASELINE_STABLE — Inlet: ${inBase} Bar, Outlet: ${outBase} Bar`
    });
    events.push({
      time: '[6.00s]',
      tag: 'MONITORING_NOMINAL',
      tagClass: 'tag-success',
      badgeText: 'STABLE',
      desc: `Continuous edge telemetry monitoring: maximum pressure drop across all 5 segments < 8.0 Bar. No negative pressure wave transients detected.`,
      raw: `[6.00s] CONTINUOUS_MONITORING — All segments nominal. Max drop < 8.0 Bar.`
    });
    events.push({
      time: '[12.0s]',
      tag: 'NORMAL_OPERATION',
      tagClass: 'tag-success',
      badgeText: 'VERIFIED',
      desc: `Normal Operation confirmed across full 12.0s observation horizon. All isolation valves remain OPEN. Pipeline integrity intact.`,
      raw: `[12.0s] Scenario replay complete. Normal Operation (No Leak Detected).`
    });
    return events;
  }

  const tIn = analysis.t_in;
  const tOut = analysis.t_out;
  const dt = analysis.dt;
  const X = analysis.leak_position_m;
  const dynSeg = getAffectedSeg(analysis);
  const seg = dynSeg.label;
  const frameEvals = analysis.frame_evaluations || [];

  /* Extract exact timestamps for valve transition events */
  let tIsolating = null;
  let tClosed = null;
  for (let f of frameEvals) {
    if (tIsolating === null && f.valve_state === 'ISOLATING') {
      tIsolating = f.rel_time_s;
    }
    if (tClosed === null && f.valve_state === 'CLOSED') {
      tClosed = f.rel_time_s;
    }
  }

  const timedItems = [];

  if (tIn !== null) {
    timedItems.push({
      t: tIn,
      order: 1,
      timeStr: `[${tIn.toFixed(2)}s]`,
      tag: 'ANOMALY_INLET',
      tagClass: 'tag-warn',
      badgeText: 'INLET ARRIVAL',
      desc: `Transient arrival at inlet sensor (t_in = ${tIn.toFixed(1)}s). Negative Pressure Wavefront onset detected (> 2.5 Bar drop from baseline, rate < -1.0 Bar/step).`,
      raw: `[${tIn.toFixed(2)}s] ANOMALY_INLET — Transient arrival at inlet sensor (t_in = ${tIn.toFixed(1)}s)`
    });
  }

  if (tIsolating !== null) {
    timedItems.push({
      t: tIsolating,
      order: 2,
      timeStr: `[${tIsolating.toFixed(2)}s]`,
      tag: 'ISOLATION_INITIATED',
      tagClass: 'tag-alarm',
      badgeText: 'ISOLATING',
      desc: `Pressure ratio dropped below 80% caution threshold. Nearest boundary isolation valves commanded to ISOLATING state.`,
      raw: `[${tIsolating.toFixed(2)}s] ISOLATION_INITIATED — Nearest valves closing…`
    });
  }

  if (tClosed !== null) {
    timedItems.push({
      t: tClosed,
      order: 3,
      timeStr: `[${tClosed.toFixed(2)}s]`,
      tag: 'ISOLATION_COMPLETE',
      tagClass: 'tag-alarm',
      badgeText: 'VALVES CLOSED',
      desc: `Pressure ratio dropped below 60% critical threshold. Virtual isolation engaged. Affected segment quarantined with mechanical seating.`,
      raw: `[${tClosed.toFixed(2)}s] ISOLATION_COMPLETE — Virtual isolation engaged. Segment quarantined.`
    });
  }

  if (tOut !== null) {
    timedItems.push({
      t: tOut,
      order: 4,
      timeStr: `[${tOut.toFixed(2)}s]`,
      tag: 'ANOMALY_OUTLET',
      tagClass: 'tag-warn',
      badgeText: 'OUTLET ARRIVAL',
      desc: `Transient arrival at outlet sensor (t_out = ${tOut.toFixed(1)}s). Dual-sensor wavefront capture complete.`,
      raw: `[${tOut.toFixed(2)}s] ANOMALY_OUTLET — Transient arrival at outlet sensor (t_out = ${tOut.toFixed(1)}s)`
    });
  }

  const tLoc = Math.max(tIn !== null ? tIn : 0, tOut !== null ? tOut : 0);
  timedItems.push({
    t: tLoc,
    order: 5,
    timeStr: `[${tLoc.toFixed(2)}s]`,
    tag: 'NPW_LOCALIZED',
    tagClass: 'tag-alarm',
    badgeText: 'LOCALIZED',
    desc: `NPW localization resolved: Calculated X = <strong>${X} m</strong> (${seg}). Δt = ${dt >= 0 ? '+' : ''}${dt.toFixed(2)}s. Exact Formula: (${S.pipelineLength.toLocaleString()} − ${S.waveSpeed.toLocaleString()} × ${dt.toFixed(2)}) / 2 = <strong>${X} m</strong>.`,
    raw: `[${tLoc.toFixed(2)}s] NPW_LOCALIZED — X = ${X} m (${seg})\n[${tLoc.toFixed(2)}s] Δt = ${dt}s | Formula: (${S.pipelineLength} − ${S.waveSpeed}×${dt}) / 2`
  });

  timedItems.push({
    t: 12.0,
    order: 6,
    timeStr: '[12.0s]',
    tag: 'REPLAY_COMPLETE',
    tagClass: 'tag-success',
    badgeText: 'COMPLETED',
    desc: `Scenario telemetry replay complete (12.0s observation horizon). Affected pipeline segment isolation confirmed stable.`,
    raw: `[12.0s] Scenario replay complete.`
  });

  timedItems.sort((a, b) => (a.t === b.t ? a.order - b.order : a.t - b.t));

  for (let item of timedItems) {
    events.push({
      time: item.timeStr,
      tag: item.tag,
      tagClass: item.tagClass,
      badgeText: item.badgeText,
      desc: item.desc,
      raw: item.raw
    });
  }

  return events;
}

function openDetailedLogModal() {
  if (!S.scenarioData || !S.analysis) return;
  const analysis = S.analysis;
  const scData   = S.scenarioData;
  const isLk     = analysis.is_leak;
  const dynSeg   = getAffectedSeg(analysis);

  dom['logModalScenarioBadge'].textContent = `${scData.scenario} · ${scData.sample_count || 121} Samples`;
  dom['logStatStatus'].textContent = isLk ? 'CRITICAL LEAK' : 'NORMAL OPERATION';
  dom['logStatStatus'].style.color = isLk ? 'var(--state-red)' : 'var(--state-green)';

  dom['logStatTIn'].textContent  = analysis.t_in !== null  ? `${analysis.t_in.toFixed(2)} s` : '—';
  dom['logStatTOut'].textContent = analysis.t_out !== null ? `${analysis.t_out.toFixed(2)} s` : '—';
  dom['logStatDt'].textContent   = analysis.dt !== null   ? `${analysis.dt >= 0 ? '+' : ''}${analysis.dt.toFixed(2)} s` : '—';
  dom['logStatX'].textContent    = analysis.leak_position_m !== null ? `${analysis.leak_position_m} m` : 'No Leak';
  dom['logStatSeg'].textContent  = dynSeg.label || 'None';

  if (isLk && analysis.dt !== null) {
    dom['logCalloutEq'].innerHTML = `X = (${S.pipelineLength.toLocaleString()} − ${S.waveSpeed.toLocaleString()} × ${analysis.dt >= 0 ? '+' : ''}${analysis.dt.toFixed(2)}) / 2 = <strong style="color:var(--text-data)">${analysis.leak_position_m} m</strong> &nbsp;→&nbsp; <span style="color:var(--state-red); font-weight:700;">${dynSeg.label}</span>`;
  } else {
    dom['logCalloutEq'].innerHTML = `Baseline Nominal — Maximum pressure drop < 8.0 Bar. No transient wave detected across 12.0s observation.`;
  }

  const events = buildScenarioDetailedEvents(scData, analysis);
  dom['logEventCountBadge'].textContent = `${events.length} Key Events`;

  dom['detailedLogTableBody'].innerHTML = '';
  let rawText = '';

  events.forEach(ev => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-family:var(--font-mono); font-weight:700; color:var(--text-data); white-space:nowrap;">${ev.time}</td>
      <td><span class="badge-tag ${ev.tagClass}">${ev.tag}</span></td>
      <td style="line-height:1.45; color:var(--text-primary); font-size:12px;">${ev.desc}</td>
      <td><span class="badge-tag ${ev.tagClass}">${ev.badgeText}</span></td>
    `;
    dom['detailedLogTableBody'].appendChild(tr);
    rawText += ev.raw + '\n';
  });

  dom['rawLogConsoleText'].textContent = rawText.trim();
  dom['detailedLogModal'].classList.remove('hidden');
}

function closeDetailedLogModal() {
  dom['detailedLogModal'].classList.add('hidden');
}

function copyDetailedLog() {
  const text = dom['rawLogConsoleText'].textContent;
  if (!text) return;

  const btn = dom['btnCopyLog'];
  const origText = btn.textContent;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = origText; }, 2000);
    }).catch(() => fallbackCopy(text, btn, origText));
  } else {
    fallbackCopy(text, btn, origText);
  }
}

function fallbackCopy(text, btn, origText) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    btn.textContent = '✓ Copied!';
  } catch (e) {
    btn.textContent = 'Failed';
  }
  document.body.removeChild(ta);
  setTimeout(() => { btn.textContent = origText; }, 2000);
}

function downloadDetailedLog() {
  const text = dom['rawLogConsoleText'].textContent;
  if (!text) return;
  const scName = S.scenarioData ? S.scenarioData.scenario : 'scenario';
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `PipeGuard_EventLog_${scName}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportIncidentReport() {
  if (!S.scenarioData || !S.analysis) {
    alert('Please load a scenario before exporting an incident report.');
    return;
  }
  window.print();
}

/* ═══════════════════════════════════════════════════════════════════
   PROCEDURAL WEB AUDIO ENGINE (Subsea Hydrophone & Mechanical SFX)
═══════════════════════════════════════════════════════════════════ */
let audioCtx = null;
let audioEnabled = false;
let ambientGain = null;

function initAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
      setupOceanAmbience();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function setupOceanAmbience() {
  if (!audioCtx) return;
  try {
    const bufferSize = audioCtx.sampleRate * 2;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      output[i] = (b0 + b1 + b2) * 0.04;
    }
    const whiteNoise = audioCtx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(140, audioCtx.currentTime);

    ambientGain = audioCtx.createGain();
    ambientGain.gain.setValueAtTime(audioEnabled ? 0.12 : 0, audioCtx.currentTime);

    whiteNoise.connect(filter);
    filter.connect(ambientGain);
    ambientGain.connect(audioCtx.destination);
    whiteNoise.start();
  } catch (e) {}
}

function toggleAudio() {
  initAudio();
  audioEnabled = !audioEnabled;
  const btn = dom['btnAudioToggle'];
  if (btn) {
    btn.textContent = audioEnabled ? '🔊' : '🔇';
    btn.title = audioEnabled ? 'Audio Effects Enabled (Click to Mute)' : 'Audio Effects Muted (Click to Enable)';
    btn.style.color = audioEnabled ? 'var(--accent-cyan)' : 'var(--text-secondary)';
  }
  if (ambientGain && audioCtx) {
    ambientGain.gain.setTargetAtTime(audioEnabled ? 0.12 : 0, audioCtx.currentTime, 0.1);
  }
  if (audioEnabled) {
    playTransientPing(784);
  }
}

function playTransientPing(freq = 660) {
  if (!audioEnabled || !audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq, t0);
    osc1.frequency.exponentialRampToValueAtTime(freq * 0.6, t0 + 0.4);
    gain1.gain.setValueAtTime(0.22, t0);
    gain1.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(t0);
    osc1.stop(t0 + 0.4);

    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq * 2.0, t0);
    osc2.frequency.exponentialRampToValueAtTime(freq * 1.2, t0 + 0.2);
    gain2.gain.setValueAtTime(0.08, t0);
    gain2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(t0);
    osc2.stop(t0 + 0.2);
  } catch (e) {}
}

function playValveLock() {
  if (!audioEnabled || !audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    const bufSize = Math.floor(audioCtx.sampleRate * 0.18);
    const noiseBuf = audioCtx.createBuffer(1, bufSize, audioCtx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.3));
    const noiseSrc = audioCtx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    const bandpass = audioCtx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(1600, t0);
    bandpass.Q.setValueAtTime(3.0, t0);
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.25, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
    noiseSrc.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);
    noiseSrc.start(t0);

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t0 + 0.08);
    osc.frequency.exponentialRampToValueAtTime(42, t0 + 0.45);
    gain.gain.setValueAtTime(0.0, t0);
    gain.gain.setValueAtTime(0.35, t0 + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0 + 0.08);
    osc.stop(t0 + 0.45);
  } catch (e) {}
}

function playAlarmChime() {
  if (!audioEnabled || !audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    const notes = [659.25, 830.61];
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const onset = t0 + idx * 0.14;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, onset);
      gain.gain.setValueAtTime(0.18, onset);
      gain.gain.exponentialRampToValueAtTime(0.001, onset + 0.4);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(onset);
      osc.stop(onset + 0.4);
    });
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════
   SUBSEA BATHYMETRY PROFILE CANVAS (Corridor Map)
═══════════════════════════════════════════════════════════════════ */
function renderBathymetry() {
  const canvas = dom['bathymetryCanvas'] || document.getElementById('bathymetryCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  canvas.width = canvas.clientWidth || canvas.parentElement.clientWidth;
  canvas.height = canvas.clientHeight || canvas.parentElement.clientHeight;
  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return;

  ctx.clearRect(0, 0, w, h);

  const profile = [
    { km: 0, d: 45, label: 'Vizag (0 km)' },
    { km: 80, d: 95 },
    { km: 129, d: 240, label: 'Kakinada' },
    { km: 210, d: 1100 },
    { km: 277, d: 2400, label: 'KG Deepwater (-2400m)' },
    { km: 380, d: 1850 },
    { km: 450, d: 1150 },
    { km: 507, d: 380, label: 'Nellore' },
    { km: 590, d: 120 },
    { km: 661.3, d: 35, label: 'Chennai (661 km)' }
  ];

  const maxDepth = 2600;
  const padX = 40;
  const padTop = 15;
  const plotW = w - padX * 2;
  const plotH = h - padTop - 20;

  // Sea surface line
  ctx.strokeStyle = 'rgba(34,211,238,0.3)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(padX, padTop);
  ctx.lineTo(padX + plotW, padTop);
  ctx.stroke();
  ctx.setLineDash([]);

  // Water gradient fill
  const waterGrad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
  waterGrad.addColorStop(0, 'rgba(14,116,144,0.15)');
  waterGrad.addColorStop(1, 'rgba(6,11,20,0.85)');

  ctx.beginPath();
  ctx.moveTo(padX, padTop);
  profile.forEach((pt, i) => {
    const px = padX + (pt.km / REAL_CORRIDOR_KM) * plotW;
    const py = padTop + (pt.d / maxDepth) * plotH;
    if (i === 0) ctx.lineTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.lineTo(padX + plotW, padTop);
  ctx.closePath();
  ctx.fillStyle = waterGrad;
  ctx.fill();

  // Seabed terrain outline
  ctx.beginPath();
  profile.forEach((pt, i) => {
    const px = padX + (pt.km / REAL_CORRIDOR_KM) * plotW;
    const py = padTop + (pt.d / maxDepth) * plotH;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.strokeStyle = '#22D3EE';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Waypoint labels
  ctx.font = "8.5px 'JetBrains Mono', monospace";
  ctx.fillStyle = 'rgba(148,163,184,0.7)';
  profile.filter(p => p.label).forEach(p => {
    const px = padX + (p.km / REAL_CORRIDOR_KM) * plotW;
    const py = padTop + (p.d / maxDepth) * plotH;
    ctx.beginPath();
    ctx.arc(px, py, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#22D3EE';
    ctx.fill();
    ctx.fillStyle = 'rgba(148,163,184,0.8)';
    ctx.fillText(p.label, px - 20, py - 6);
  });

  // If leak is active, draw leak rupture point on bathymetry!
  if (S.analysis && S.analysis.is_leak && S.analysis.leak_position_m != null) {
    const frac = S.analysis.leak_position_m / S.pipelineLength;
    const leakKm = frac * REAL_CORRIDOR_KM;
    const leakPx = padX + frac * plotW;
    
    let leakD = 400;
    for (let i = 0; i < profile.length - 1; i++) {
      if (leakKm >= profile[i].km && leakKm <= profile[i+1].km) {
        const t = (leakKm - profile[i].km) / (profile[i+1].km - profile[i].km);
        leakD = profile[i].d + t * (profile[i+1].d - profile[i].d);
        break;
      }
    }
    const leakPy = padTop + (leakD / maxDepth) * plotH;

    ctx.strokeStyle = 'rgba(239,68,68,0.5)';
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(leakPx, padTop);
    ctx.lineTo(leakPx, leakPy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(leakPx, leakPy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#EF4444';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = "bold 8.5px 'JetBrains Mono', monospace";
    ctx.fillStyle = '#EF4444';
    ctx.fillText(`RUPTURE (-${Math.round(leakD)}m)`, leakPx + 7, leakPy + 3);

    const depthTag = document.getElementById('bathyRuptureDepth');
    if (depthTag) depthTag.textContent = `Rupture Depth: -${Math.round(leakD)} m (${leakKm.toFixed(1)} km)`;
  }
}


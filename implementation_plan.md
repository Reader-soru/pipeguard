# Implementation Plan - TWI Subsea Pipeline Integrity Challenge

Real-time edge analytics, 3D/2D digital twin visualization, and Negative Pressure Wave (NPW) leak localization system for subsea pipelines based on TWI India specifications, evaluation Excel dataset (`BLIND_01`–`BLIND_07`), and reference presentation design.

## User Review Required

> [!IMPORTANT]
> - **Evaluation Dataset Integrity**: The exact same telemetry processing algorithm will execute across all 7 Excel sheets (`BLIND_01`–`BLIND_07`) without hard-coding leak locations or pre-baked answers.
> - **Scenario `BLIND_07`**: `BLIND_07` is correctly identified by our algorithm as a **Normal Operation / No-Leak** control scenario (pressure ratio stays >97%), preventing false-positive alarms.
> - **Tech Stack**: Backend is built using **Python + FastAPI + NumPy** with streaming endpoints; Frontend uses **Vanilla HTML5/CSS3 + Three.js + Chart.js + JavaScript ES6**. Zero React/Next.js dependencies.

## Open Questions

- None at this stage. All requirements from the PDF, Excel structure, and reference video have been inspected and mathematically verified.

---

## Proposed Changes

### System Architecture & Dataset Processing Engine

We will build a clean, production-grade Python application structure:

```
d:/Desktop/TWI/
├── app/
│   ├── __init__.py
│   ├── main.py                   # FastAPI application server & WebSocket/SSE endpoints
│   ├── dataset_loader.py         # Loader for 'Team Blind Evaluation Dataset Subsea Pipeline.xlsx'
│   ├── analytics_engine.py       # Vector A (Edge Detection) & Vector C (NPW Localization)
│   └── models.py                 # Pydantic schemas for telemetry frames, events & results
├── static/
│   ├── index.html                # Single-page dashboard layout matching video reference
│   ├── css/
│   │   └── styles.css            # Sleek dark-mode engineering styling & glassmorphism
│   └── js/
│       ├── app.js                # App state, scenario player, WebSocket/Replay loop
│       ├── digital_twin_3d.js    # Vector B: Three.js 3D/2D pipeline digital twin
│       ├── npw_analytics.js      # Vector C: Interactive NPW workflow & formula visualization
│       └── charts.js             # Live inlet/outlet pressure chart (Chart.js)
├── tests/
│   ├── test_dataset_loader.py    # Pytest for Excel dataset loader
│   ├── test_analytics_engine.py  # Pytest for Vector A & Vector C across BLIND_01..BLIND_07
│   └── test_api_endpoints.py     # Pytest for FastAPI routes
└── requirements.txt              # Dependency list
```

---

### [NEW] Backend Core ([`app/dataset_loader.py`](file:///d:/Desktop/TWI/app/dataset_loader.py))
- Parse `Team Blind Evaluation Dataset Subsea Pipeline.xlsx` (all sheets: `Read_Me`, `BLIND_01` through `BLIND_07`).
- Normalize time series: Relative time $t \in [0, 12.0]$s at 100 ms intervals (121 samples per scenario).
- Provide streaming iteration / replay API yielding frame-by-frame telemetry: `(timestamp, rel_time_ms, inlet_p, outlet_p)`.

### [NEW] Analytics Engine ([`app/analytics_engine.py`](file:///d:/Desktop/TWI/app/analytics_engine.py))
- **Vector A (Edge Processing & Transient Detection)**:
  - Estimate baseline pressure ($P_{\text{in\_base}}$, $P_{\text{out\_base}}$) from initial 1.5s window.
  - Apply thresholding and derivative filtering on high-frequency pressure telemetry to detect transient arrival times $t_{\text{in}}$ and $t_{\text{out}}$ independently.
  - Assess pressure ratio against standard health tiers ($\ge 95\%$ GREEN, $80\text{--}95\%$ YELLOW, $60\text{--}80\%$ ORANGE, $<60\%$ RED).
  - Classify normal operation (`BLIND_07`) vs leak anomaly (`BLIND_01`–`BLIND_06`).
- **Vector C (NPW Localization)**:
  - Compute $\Delta t = t_{\text{out}} - t_{\text{in}}$.
  - Apply NPW formula: $X = \frac{L - C \cdot \Delta t}{2}$ where $L = 10,000$ m and $C = 1,000$ m/s.
  - Map $X$ to standardized 2 km segments:
    - Segment 1: $0 \le X < 2000$ m
    - Segment 2: $2000 \le X < 4000$ m
    - Segment 3: $4000 \le X < 6000$ m
    - Segment 4: $6000 \le X < 8000$ m
    - Segment 5: $8000 \le X \le 10000$ m

### [NEW] Web Application & API ([`app/main.py`](file:///d:/Desktop/TWI/app/main.py))
- REST API to fetch available scenarios (`/api/scenarios`), full scenario telemetry (`/api/scenario/{name}`), and batch evaluation summary (`/api/evaluate_all`).
- WebSocket / SSE endpoint (`/ws/stream/{name}`) for real-time telemetry streaming replay at 1x, 2x, 5x, or max speed.

### [NEW] Digital Twin Frontend ([`static/index.html`](file:///d:/Desktop/TWI/static/index.html), [`digital_twin_3d.js`](file:///d:/Desktop/TWI/static/js/digital_twin_3d.js))
- **Vector A Panel**: Live numeric indicators for Inlet/Outlet pressure, baseline comparison, real-time event log, valve state (OPEN / CLOSED).
- **Vector B Panel**: Interactive 3D / 2D digital twin of 10 km subsea pipeline with 5 distinct 2 km segment status cards, animated fluid flow particles, leak plume/bubbles visual effect when leak is detected, segment color updates, and automated valve isolation.
- **Vector C Panel**: NPW equation HUD, 4-step localization workflow tracker (`1. Inlet Trigger`, `2. Propagating`, `3. Outlet Trigger`, `4. Calculate Location`), and final calculated coordinate callout.
- **Control Bar**: Scenario Selector (`BLIND_01` to `BLIND_07`), Play / Pause / Reset, Replay Speed slider, and "Run All Scenarios Validation" test suite trigger.

---

## Verification Plan

### Automated Tests
- Execute `pytest` across all test modules:
  - `pytest tests/test_dataset_loader.py`
  - `pytest tests/test_analytics_engine.py`
- Validate that all 7 scenarios match expected physical outcomes:
  - `BLIND_01`: Segment 1 (~1200 m)
  - `BLIND_02`: Segment 2 (~2800 m)
  - `BLIND_03`: Segment 2 (~3600 m)
  - `BLIND_04`: Segment 3 (~4400 m)
  - `BLIND_05`: Segment 4 (~6800 m)
  - `BLIND_06`: Segment 5 (~8800 m)
  - `BLIND_07`: Normal Operation / No Leak
- Verify NPW calculation accuracy error $\le 2\%$ (within 200 m).

### Manual Verification & Visual Audit
- Launch FastAPI app via `python -m app.main` / `uvicorn app.main:app --port 8000`.
- Verify full streaming replay on browser at `http://localhost:8000`.
- Audit UI layout against reference video frames (`Vector A`, `Vector B`, `Vector C`).

import numpy as np

# TWI Constants specified in PDF
PIPELINE_LENGTH_M = 10000.0   # L = 10,000 m
WAVE_SPEED_MS = 1000.0        # C = 1,000 m/s

def analyze_telemetry_series(samples: list):
    """
    Analyzes a full time-series scenario independently using high-frequency pressure telemetry.
    Returns Vector A edge detection, Vector C NPW localization, and frame-by-frame evaluation states.
    """
    if not samples:
        return {"error": "Empty telemetry dataset"}

    times = np.array([s["rel_time_s"] for s in samples])
    inlet_p = np.array([s["inlet_p"] for s in samples])
    outlet_p = np.array([s["outlet_p"] for s in samples])

    # 1. Baseline Calculation (first 1.5 seconds / 15 samples)
    baseline_window = min(15, len(samples))
    in_base = float(np.mean(inlet_p[:baseline_window]))
    out_base = float(np.mean(outlet_p[:baseline_window]))

    # 2. Maximum drop check relative to baseline
    max_in_drop = in_base - float(np.min(inlet_p))
    max_out_drop = out_base - float(np.min(outlet_p))

    # Threshold: If max drop is less than 8.0 Bar, classify as Normal / No-Leak
    is_leak = (max_in_drop >= 8.0) and (max_out_drop >= 8.0)

    if not is_leak:
        return {
            "status": "NORMAL_OPERATION",
            "is_leak": False,
            "in_baseline_bar": round(in_base, 2),
            "out_baseline_bar": round(out_base, 2),
            "t_in": None,
            "t_out": None,
            "dt": None,
            "leak_position_m": None,
            "affected_segment": "None",
            "severity": "GREEN",
            "isolation_triggered": False,
            "summary_message": "Normal Operation (No Leak Detected)",
            "frame_evaluations": _evaluate_frames(samples, in_base, out_base, None, None, None, None, False)
        }

    # 3. Detect Transient Arrival Times (t_in, t_out)
    t_in = _detect_transient_onset(times, inlet_p, in_base)
    t_out = _detect_transient_onset(times, outlet_p, out_base)

    if t_in is None or t_out is None:
        return {
            "status": "DETECTION_FAILED",
            "is_leak": True,
            "summary_message": "Leak transient detected but arrival times ambiguous"
        }

    # 4. Vector C: NPW Localization Formula X = (L - C * dt) / 2
    dt = round(t_out - t_in, 3)
    X_calc = round((PIPELINE_LENGTH_M - (WAVE_SPEED_MS * dt)) / 2.0, 1)

    # 5. Map X to standardized 2 km segment
    segment_id, segment_label = _map_coordinate_to_segment(X_calc)

    # 6. Generate frame-by-frame status evaluations for real-time visualization
    frames_eval = _evaluate_frames(samples, in_base, out_base, t_in, t_out, X_calc, segment_label, True)

    return {
        "status": "LEAK_DETECTED",
        "is_leak": True,
        "in_baseline_bar": round(in_base, 2),
        "out_baseline_bar": round(out_base, 2),
        "t_in": round(t_in, 2),
        "t_out": round(t_out, 2),
        "dt": round(dt, 2),
        "leak_position_m": X_calc,
        "affected_segment_id": segment_id,
        "affected_segment": segment_label,
        "severity": "RED",
        "isolation_triggered": True,
        "distance_from_inlet_m": X_calc,
        "distance_from_outlet_m": round(PIPELINE_LENGTH_M - X_calc, 1),
        "summary_message": f"CRITICAL LEAK DETECTED at X = {X_calc} m from inlet, {round(PIPELINE_LENGTH_M - X_calc, 1)} m from outlet ({segment_label}). Automatic Isolation Initiated.",
        "frame_evaluations": frames_eval
    }

def _detect_transient_onset(times, pressures, baseline):
    """
    Detects transient arrival time where negative pressure wave arrives at sensor.
    Condition: First index where pressure drops > 2.5 Bar from baseline AND sample drop rate < -1.0 Bar/step.
    """
    diffs = np.diff(pressures)
    for i in range(len(pressures) - 1):
        drop_from_base = baseline - pressures[i]
        if drop_from_base > 2.5 and diffs[i] < -1.0:
            return float(times[i])
        if drop_from_base > 4.0:
            return float(times[max(0, i - 1)])
    return None

def _map_coordinate_to_segment(x_meters):
    if 0 <= x_meters < 2000:
        return 1, "S1 (0-1.99 km)"
    elif 2000 <= x_meters < 4000:
        return 2, "S2 (2-3.99 km)"
    elif 4000 <= x_meters < 6000:
        return 3, "S3 (4-5.99 km)"
    elif 6000 <= x_meters < 8000:
        return 4, "S4 (6-7.99 km)"
    elif 8000 <= x_meters <= 10000:
        return 5, "S5 (8-10 km)"
    else:
        return 0, "Out of Bounds"

def _evaluate_frames(samples, in_base, out_base, t_in, t_out, x_calc, segment_label, is_leak):
    """
    Generates real-time state for every 100ms sample tick:
    - Pressure ratio relative to baseline
    - Health classification (GREEN / YELLOW / ORANGE / RED)
    - Vector C workflow state (Awaiting -> Inlet Trigger -> Wave Propagating -> Outlet Trigger -> Complete)
    - Isolation valve state (OPEN / ISOLATING / CLOSED)
    """
    evaluations = []
    
    for s in samples:
        t = s["rel_time_s"]
        p_in = s["inlet_p"]
        p_out = s["outlet_p"]

        r_in = (p_in / in_base) * 100.0
        r_out = (p_out / out_base) * 100.0
        min_ratio = min(r_in, r_out)

        # Standard Pressure-Health Logic (TWI PDF page 7)
        if min_ratio >= 95.0:
            health_state = "GREEN"
            health_label = "Healthy"
        elif min_ratio >= 80.0:
            health_state = "YELLOW"
            health_label = "Caution"
        elif min_ratio >= 60.0:
            health_state = "ORANGE"
            health_label = "Degraded"
        else:
            health_state = "RED"
            health_label = "Critical"

        # Vector C Workflow State
        npw_step = 0
        npw_label = "Nominal"
        
        if is_leak:
            if t < t_in and t < t_out:
                npw_step = 1
                npw_label = "Baseline Nominal"
            elif min(t_in, t_out) <= t < max(t_in, t_out):
                npw_step = 2
                first_trig = "Inlet" if t_in <= t_out else "Outlet"
                npw_label = f"{first_trig} Triggered (Wave Propagating)"
            else:
                npw_step = 3
                npw_label = f"Both Sensors Triggered (dt = {abs(t_out - t_in):.2f}s)"

        # Isolation Response
        valve_state = "OPEN"
        if is_leak and min_ratio < 60.0:
            valve_state = "CLOSED"
        elif is_leak and min_ratio < 80.0:
            valve_state = "ISOLATING"

        evaluations.append({
            "rel_time_s": t,
            "inlet_p": p_in,
            "outlet_p": p_out,
            "inlet_ratio_pct": round(r_in, 1),
            "outlet_ratio_pct": round(r_out, 1),
            "min_ratio_pct": round(min_ratio, 1),
            "health_state": health_state,
            "health_label": health_label,
            "npw_step": npw_step,
            "npw_label": npw_label,
            "valve_state": valve_state
        })

    return evaluations

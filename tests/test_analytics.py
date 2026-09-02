import pytest
import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from dataset_loader import load_scenario_telemetry, get_available_scenarios
from analytics import analyze_telemetry_series

def test_available_scenarios():
    scenarios = get_available_scenarios()
    assert len(scenarios) == 7
    assert "BLIND_01" in scenarios
    assert "BLIND_07" in scenarios

def test_blind_01_to_06_leak_detection():
    for sc in ["BLIND_01", "BLIND_02", "BLIND_03", "BLIND_04", "BLIND_05", "BLIND_06"]:
        telemetry = load_scenario_telemetry(sc)
        res = analyze_telemetry_series(telemetry)
        assert res["status"] == "LEAK_DETECTED"
        assert res["is_leak"] is True
        assert res["t_in"] is not None
        assert res["t_out"] is not None
        assert res["leak_position_m"] is not None
        assert 0 <= res["leak_position_m"] <= 10000

def test_blind_07_normal_operation():
    telemetry = load_scenario_telemetry("BLIND_07")
    res = analyze_telemetry_series(telemetry)
    assert res["status"] == "NORMAL_OPERATION"
    assert res["is_leak"] is False
    assert res["t_in"] is None
    assert res["t_out"] is None
    assert res["isolation_triggered"] is False

def test_npw_equation_math():
    # Verification of formula X = (L - C*dt)/2 with reference values from PDF page 4:
    # L = 10000, C = 1000, t_in = 2.40s, t_out = 7.60s => dt = 5.20s => X = 2400m
    L = 10000.0
    C = 1000.0
    dt = 7.60 - 2.40
    X = (L - C * dt) / 2.0
    assert abs(X - 2400.0) < 1e-5

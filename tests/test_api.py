from fastapi.testclient import TestClient
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from app import app

client = TestClient(app)

def test_api_scenarios():
    response = client.get("/api/scenarios")
    assert response.status_code == 200
    data = response.json()
    assert "scenarios" in data
    assert "BLIND_01" in data["scenarios"]

def test_api_scenario_detail():
    response = client.get("/api/scenario/BLIND_01")
    assert response.status_code == 200
    data = response.json()
    assert data["scenario"] == "BLIND_01"
    assert "telemetry" in data
    assert "analysis" in data
    assert data["analysis"]["status"] == "LEAK_DETECTED"

def test_api_evaluate_all():
    response = client.get("/api/evaluate_all")
    assert response.status_code == 200
    data = response.json()
    assert "summary" in data
    assert len(data["summary"]) == 7

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

from dataset_loader import load_scenario_telemetry, get_available_scenarios
from analytics import analyze_telemetry_series

app = FastAPI(title="TWI Subsea Pipeline Integrity Twin API")

# Serve static files
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def get_dashboard():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "API running. static/index.html missing."}

@app.get("/api/scenarios")
def list_scenarios():
    try:
        scenarios = get_available_scenarios()
        return {"scenarios": scenarios}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/scenario/{name}")
def get_scenario_data(name: str):
    scenarios = get_available_scenarios()
    if name not in scenarios:
        raise HTTPException(status_code=404, detail=f"Scenario '{name}' not found. Available: {scenarios}")
    
    try:
        telemetry = load_scenario_telemetry(name)
        analysis = analyze_telemetry_series(telemetry)
        return {
            "scenario": name,
            "sample_count": len(telemetry),
            "telemetry": telemetry,
            "analysis": analysis
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/upload_scenario")
async def upload_scenario(file: UploadFile = File(...)):
    try:
        content = await file.read()
        csv_str = content.decode("utf-8")
        from dataset_loader import parse_csv_telemetry
        telemetry = parse_csv_telemetry(csv_str)
        if not telemetry:
            raise ValueError("No valid telemetry data found in CSV")
        
        analysis = analyze_telemetry_series(telemetry)
        return {
            "scenario": file.filename,
            "sample_count": len(telemetry),
            "telemetry": telemetry,
            "analysis": analysis
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/evaluate_all")
def evaluate_all_scenarios():
    """
    Evaluation suite endpoint: processes every scenario (BLIND_01 through BLIND_07)
    with the exact same unmodified algorithm and returns a summary report.
    """
    scenarios = get_available_scenarios()
    results = []
    
    for sc in scenarios:
        telemetry = load_scenario_telemetry(sc)
        res = analyze_telemetry_series(telemetry)
        results.append({
            "scenario": sc,
            "status": res["status"],
            "is_leak": res["is_leak"],
            "in_base_bar": res.get("in_baseline_bar"),
            "out_base_bar": res.get("out_baseline_bar"),
            "t_in": res.get("t_in"),
            "t_out": res.get("t_out"),
            "dt": res.get("dt"),
            "leak_position_m": res.get("leak_position_m"),
            "affected_segment": res.get("affected_segment"),
            "isolation_triggered": res.get("isolation_triggered")
        })
        
    return {"summary": results}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    uvicorn.run(app, host=host, port=port)

from fastapi.testclient import TestClient

from app.server import app


def test_health_reports_protocols() -> None:
    response = TestClient(app).get("/api/health")

    assert response.status_code == 200
    assert response.json()["protocols"] == {
        "agUi": "0.1",
        "a2ui": "0.9",
        "a2a": "0.3",
    }


def test_ag_ui_capabilities_are_discoverable() -> None:
    response = TestClient(app).get("/api/ag-ui/capabilities")

    assert response.status_code == 200
    assert response.json()["custom"]["a2aRegistry"] is True

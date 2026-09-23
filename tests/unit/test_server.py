from fastapi.testclient import TestClient

from app.server import app


def test_health_reports_protocols() -> None:
    response = TestClient(app).get("/api/health")

    assert response.status_code == 200
    assert response.json()["protocols"] == {
        "agUi": "1.0",
        "a2ui": "v1.0 candidate (pinned)",
        "a2a": "1.0 (0.3 compatibility)",
        "mcp": "2.2 SDK",
        "http": "JSON",
        "openapi": "3.0 / 3.1 / 3.2 JSON subset",
        "adapterContract": "1.0",
    }


def test_adapter_descriptors_are_discoverable() -> None:
    response = TestClient(app).get("/api/connections/adapters")
    assert response.status_code == 200
    assert response.json()["contractVersion"] == "1.0"
    kinds = {adapter["kind"] for adapter in response.json()["adapters"]}
    assert {"http", "mcp", "agui", "a2a", "openapi"} <= kinds


def test_visualization_contracts_are_discoverable() -> None:
    response = TestClient(app).get("/api/connections/visualizations")
    assert response.status_code == 200
    payload = response.json()
    assert {item["kind"] for item in payload["formats"]} == {
        "vega",
        "vega-lite",
        "svg",
        "dashboard",
    }
    assert payload["security"]["agentJavaScript"] is False
    assert payload["security"]["externalResources"] is False


def test_ag_ui_capabilities_are_discoverable() -> None:
    response = TestClient(app).get("/api/ag-ui/capabilities")

    assert response.status_code == 200
    assert response.json()["custom"]["a2aRegistry"] is True

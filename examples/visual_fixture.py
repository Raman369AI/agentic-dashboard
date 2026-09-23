"""Declarative visuals from a service, with no client renderer registration."""

from fastapi import APIRouter

router = APIRouter()


@router.post("/visuals")
async def visuals(body: dict) -> dict:
    if body.get("prompt") == "unsafe":
        return {
            "kind": "dashboard",
            "children": [
                {
                    "kind": "svg",
                    "title": "Blocked SVG",
                    "svg": '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
                },
                {
                    "kind": "vega-lite",
                    "title": "Blocked remote data",
                    "spec": {
                        "data": {"url": "https://example.invalid/should-not-load"},
                        "mark": "bar",
                    },
                },
            ],
        }
    return {
        "kind": "dashboard",
        "title": "Service-defined operations view",
        "columns": 1,
        "children": [
            {
                "kind": "vega-lite",
                "title": "Revenue trend",
                "spec": {
                    "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
                    "width": 420,
                    "height": 180,
                    "params": [
                        {
                            "name": "minimum",
                            "value": 0,
                            "bind": {
                                "input": "range",
                                "name": "Minimum revenue",
                                "min": 0,
                                "max": 100,
                                "step": 10,
                            },
                        }
                    ],
                    "data": {
                        "values": [
                            {"month": "Jan", "revenue": 20},
                            {"month": "Feb", "revenue": 60},
                            {"month": "Mar", "revenue": 90},
                        ]
                    },
                    "transform": [{"filter": "datum.revenue >= minimum"}],
                    "mark": {"type": "line", "point": True},
                    "encoding": {
                        "x": {"field": "month", "type": "ordinal", "sort": None},
                        "y": {"field": "revenue", "type": "quantitative"},
                    },
                },
            },
            {
                "kind": "vendor.pipeline",
                "presentation": {
                    "kind": "svg",
                    "title": "Custom service topology",
                    "svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 150"><rect width="480" height="150" fill="#101827"/><path d="M145 75H330" stroke="#8b87ff" stroke-width="4"/><rect x="20" y="40" width="125" height="70" rx="14" fill="#5750cc"/><circle cx="360" cy="75" r="48" fill="#087f70"/><text x="82" y="80" text-anchor="middle" fill="white" font-family="sans-serif" font-size="15">Agent</text><text x="360" y="80" text-anchor="middle" fill="white" font-family="sans-serif" font-size="15">Semantic API</text></svg>',
                },
                "metadata": {"vendorType": "No client module installed"},
            },
            {"kind": "metric", "label": "Connected systems", "value": 2},
        ],
    }

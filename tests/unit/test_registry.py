from pathlib import Path

import httpx
import pytest

import app.domain.registry as registry_module
from app.domain.registry import (
    AgentRegistry,
    RegistryError,
    invoke_agent,
    validate_remote_url,
)


def test_registry_round_trip(tmp_path: Path) -> None:
    registry = AgentRegistry(tmp_path / "registry.db")
    record = registry.save(
        "https://agents.example.com",
        {"name": "Researcher", "description": "Finds evidence."},
    )

    assert registry.get(record.id) == record
    assert registry.all() == [record]
    assert registry.delete(record.id) is True
    assert registry.all() == []


def test_registry_rejects_duplicate_url(tmp_path: Path) -> None:
    registry = AgentRegistry(tmp_path / "registry.db")
    card = {"name": "Researcher", "description": "Finds evidence."}
    registry.save("https://agents.example.com", card)

    with pytest.raises(RegistryError, match="already registered"):
        registry.save("https://agents.example.com", card)


@pytest.mark.asyncio
async def test_private_agent_urls_are_blocked() -> None:
    with pytest.raises(RegistryError, match="Private-network"):
        await validate_remote_url("http://127.0.0.1:9000", allow_private=False)


@pytest.mark.asyncio
async def test_private_agent_urls_can_be_enabled_for_local_dev() -> None:
    value = await validate_remote_url("http://127.0.0.1:9000", allow_private=True)
    assert value == "http://127.0.0.1:9000"


@pytest.mark.asyncio
async def test_legacy_invoke_guards_every_outgoing_request(tmp_path, monkeypatch):
    record = AgentRegistry(tmp_path / "registry.db").save(
        "https://public.example", {"name": "Researcher"}
    )
    sent = []
    original_client = httpx.AsyncClient

    def client(*args, **kwargs):
        def respond(request):
            sent.append(str(request.url))
            return httpx.Response(200)

        return original_client(*args, transport=httpx.MockTransport(respond), **kwargs)

    async def validate(url, allow_private):
        assert allow_private is False
        if url.startswith("http://127.0.0.1"):
            raise RegistryError("Private-network agents are disabled.")
        return url

    class Resolver:
        def __init__(self, http_client, base_url):
            self.http_client = http_client
            self.base_url = base_url

        async def get_agent_card(self):
            await self.http_client.get(self.base_url + "/.well-known/agent-card.json")
            return object()

    class Remote:
        def __init__(self, http_client):
            self.http_client = http_client

        async def send_message(self, request):
            await self.http_client.post("http://127.0.0.1/private")
            yield request.message

    class Factory:
        def __init__(self, config):
            self.http_client = config.httpx_client

        def create(self, card):
            return Remote(self.http_client)

    monkeypatch.setattr(registry_module.httpx, "AsyncClient", client)
    monkeypatch.setattr(registry_module, "validate_remote_url", validate)
    monkeypatch.setattr(registry_module, "A2ACardResolver", Resolver)
    monkeypatch.setattr(registry_module, "ClientFactory", Factory)

    with pytest.raises(RegistryError, match="Private-network"):
        await invoke_agent(record, "hello", 10, False)
    assert sent == ["https://public.example/.well-known/agent-card.json"]

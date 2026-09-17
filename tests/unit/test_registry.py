from pathlib import Path

import pytest

from app.domain.registry import AgentRegistry, RegistryError, validate_remote_url


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

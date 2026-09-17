from __future__ import annotations

import ipaddress
import json
import socket
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

import httpx
from a2a.client.card_resolver import A2ACardResolver
from a2a.client.client import ClientConfig
from a2a.client.client_factory import ClientFactory
from a2a.types import Message, Part, Role, TextPart


class RegistryError(ValueError):
    pass


@dataclass(slots=True)
class AgentRecord:
    id: str
    name: str
    description: str
    base_url: str
    status: str
    card: dict
    created_at: str

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "baseUrl": self.base_url,
            "status": self.status,
            "card": self.card,
            "createdAt": self.created_at,
        }


class AgentRegistry:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS agents (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL,
                    base_url TEXT NOT NULL UNIQUE,
                    status TEXT NOT NULL,
                    card_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def all(self) -> list[AgentRecord]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM agents ORDER BY created_at DESC"
            ).fetchall()
        return [self._from_row(row) for row in rows]

    def get(self, agent_id: str) -> AgentRecord | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM agents WHERE id = ?", (agent_id,)
            ).fetchone()
        return self._from_row(row) if row else None

    def save(self, base_url: str, card: dict) -> AgentRecord:
        record = AgentRecord(
            id=str(uuid.uuid4()),
            name=str(card["name"]),
            description=str(card.get("description", "")),
            base_url=base_url.rstrip("/"),
            status="online",
            card=card,
            created_at=datetime.now(UTC).isoformat(),
        )
        try:
            with self._connect() as connection:
                connection.execute(
                    "INSERT INTO agents VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        record.id,
                        record.name,
                        record.description,
                        record.base_url,
                        record.status,
                        json.dumps(record.card),
                        record.created_at,
                    ),
                )
        except sqlite3.IntegrityError as error:
            raise RegistryError("This agent is already registered.") from error
        return record

    def delete(self, agent_id: str) -> bool:
        with self._connect() as connection:
            result = connection.execute("DELETE FROM agents WHERE id = ?", (agent_id,))
        return result.rowcount > 0

    @staticmethod
    def _from_row(row: sqlite3.Row) -> AgentRecord:
        return AgentRecord(
            id=row["id"],
            name=row["name"],
            description=row["description"],
            base_url=row["base_url"],
            status=row["status"],
            card=json.loads(row["card_json"]),
            created_at=row["created_at"],
        )


async def validate_remote_url(url: str, allow_private: bool) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise RegistryError("Use a complete http:// or https:// agent URL.")
    if parsed.username or parsed.password:
        raise RegistryError("Credentials are not allowed in an agent URL.")

    try:
        default_port = 443 if parsed.scheme == "https" else 80
        addresses = (
            await __import__("asyncio")
            .get_running_loop()
            .run_in_executor(
                None,
                lambda: socket.getaddrinfo(
                    parsed.hostname, parsed.port or default_port
                ),
            )
        )
    except socket.gaierror as error:
        raise RegistryError("The agent hostname could not be resolved.") from error

    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        blocked = ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
        if blocked and not allow_private:
            raise RegistryError(
                "Private-network agents are disabled. Set ALLOW_PRIVATE_AGENTS=true for local development."
            )
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip("/")


async def discover_agent(base_url: str, timeout: float) -> dict:
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        card = await A2ACardResolver(client, base_url).get_agent_card()
    return card.model_dump(mode="json", by_alias=True, exclude_none=True)


async def invoke_agent(record: AgentRecord, prompt: str, timeout: float) -> list[dict]:
    async with httpx.AsyncClient(
        timeout=timeout, follow_redirects=False
    ) as http_client:
        client = await ClientFactory.connect(
            record.base_url,
            client_config=ClientConfig(httpx_client=http_client, streaming=True),
        )
        message = Message(
            role=Role.user,
            message_id=str(uuid.uuid4()),
            parts=[Part(root=TextPart(text=prompt))],
        )
        events: list[dict] = []
        async for event in client.send_message(message):
            if isinstance(event, tuple):
                task, update = event
                events.append(
                    {
                        "task": task.model_dump(
                            mode="json", by_alias=True, exclude_none=True
                        ),
                        "update": update.model_dump(
                            mode="json", by_alias=True, exclude_none=True
                        )
                        if update
                        else None,
                    }
                )
            else:
                events.append(
                    event.model_dump(mode="json", by_alias=True, exclude_none=True)
                )
        return events

import json
from collections.abc import Iterable
from dataclasses import dataclass, field
from types import TracebackType
from typing import Self
from uuid import uuid4

import httpx

from .settings import Settings


@dataclass
class AgentResult:
    text: str = ""
    tools: list[dict] = field(default_factory=list)


class AgentRunError(RuntimeError):
    def __init__(self, message: str, result: AgentResult) -> None:
        super().__init__(message)
        self.result = result


def read_stream(lines: Iterable[str]) -> AgentResult:
    """Read the AI SDK UI message stream, including failed and repeated tool calls."""
    result = AgentResult()
    calls = {}
    finished = False
    for line in lines:
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            finished = True
            break
        event = json.loads(payload)
        kind = event.get("type")
        if kind == "text-delta":
            result.text += event["delta"]
        elif kind == "tool-input-available":
            call = {
                "id": event["toolCallId"],
                "name": event["toolName"],
                "input": event["input"],
            }
            calls[call["id"]] = call
            result.tools.append(call)
        elif kind in ("tool-output-available", "tool-output-error"):
            call_id = event["toolCallId"]
            if call_id not in calls:
                raise ValueError(f"Tool output without input: {call_id}")
            calls[call_id]["output"] = (
                event["output"]
                if kind == "tool-output-available"
                else {"error": event["errorText"]}
            )
        elif kind == "tool-input-error":
            result.tools.append(
                {
                    "id": event["toolCallId"],
                    "name": event["toolName"],
                    "input": event.get("input"),
                    "output": {"error": event["errorText"]},
                }
            )
        elif kind == "error":
            raise AgentRunError(f"Agent stream failed: {event['errorText']}", result)
        elif kind == "abort":
            raise AgentRunError("Agent stream was aborted.", result)
    if not finished:
        raise AgentRunError("Agent stream ended without [DONE].", result)
    if any("output" not in call for call in result.tools):
        raise AgentRunError("Agent stream ended with unfinished tool calls.", result)
    if not result.text.strip():
        raise AgentRunError("Agent returned no answer.", result)
    return result


class AgentClient:
    def __init__(self, settings: Settings, *, transport: httpx.BaseTransport | None = None) -> None:
        self.settings = settings
        self.http = httpx.Client(
            base_url=settings.base_url,
            headers={"Origin": settings.base_url},
            timeout=httpx.Timeout(180, connect=10),
            transport=transport,
        )

    def __enter__(self) -> Self:
        try:
            response = self.http.post(
                "/api/auth/sign-in/email",
                json={
                    "email": self.settings.email,
                    "password": self.settings.password,
                },
            )
            if response.status_code in (400, 401):
                raise RuntimeError(
                    "Eval login failed. Check credentials or run python -m harness.account."
                )
            response.raise_for_status()
            if not self.http.cookies:
                raise RuntimeError("Eval login returned no session cookie.")
        except Exception:
            self.http.close()
            raise
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        try:
            self.http.post("/api/auth/sign-out", json={}).raise_for_status()
        finally:
            self.http.close()

    def ask(self, question: str) -> AgentResult:
        with self.http.stream(
            "POST",
            "/chat",
            json={
                "messages": [
                    {
                        "id": str(uuid4()),
                        "role": "user",
                        "parts": [{"type": "text", "text": question}],
                    }
                ],
            },
        ) as response:
            response.raise_for_status()
            return read_stream(response.iter_lines())

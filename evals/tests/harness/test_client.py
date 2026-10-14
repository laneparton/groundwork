import json

import httpx
import pytest

from harness.client import AgentClient, read_stream
from harness.settings import Settings


def stream(*events: dict[str, object]) -> list[str]:
    return [f"data: {json.dumps(event)}" for event in events] + ["data: [DONE]"]


def test_authenticated_agent_request_keeps_cookie_and_signs_out() -> None:
    requests = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/api/auth/sign-in/email":
            assert json.loads(request.content) == {
                "email": "eval@example.com",
                "password": "test-password",
            }
            return httpx.Response(200, headers={"set-cookie": "session=fixture; Path=/; HttpOnly"})
        assert request.headers["cookie"] == "session=fixture"
        if request.url.path == "/chat":
            assert json.loads(request.content)["messages"][0]["parts"][0]["text"] == "What license?"
            events = stream(
                {
                    "type": "tool-input-available",
                    "toolCallId": "call-1",
                    "toolName": "query_sql",
                    "input": {"sql": "SELECT 1"},
                },
                {
                    "type": "tool-output-available",
                    "toolCallId": "call-1",
                    "output": {"rows": [{"Licenses": ["MIT"]}], "truncated": False},
                },
                {"type": "text-delta", "delta": "MIT"},
            )
            return httpx.Response(
                200, text="\n\n".join(events), headers={"content-type": "text/event-stream"}
            )
        assert request.url.path == "/api/auth/sign-out"
        return httpx.Response(200, json={"success": True})

    settings = Settings("http://localhost:3000", "eval@example.com", "test-password", "judge")
    with AgentClient(settings, transport=httpx.MockTransport(handler)) as agent:
        result = agent.ask("What license?")
    assert result.text == "MIT"
    assert result.tools[0]["output"]["rows"][0]["Licenses"] == ["MIT"]
    assert len(requests) == 3


def test_failed_login_does_not_call_chat() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/auth/sign-in/email"
        return httpx.Response(401)

    settings = Settings("http://localhost:3000", "eval@example.com", "wrong-password", "judge")
    with (
        pytest.raises(RuntimeError, match="Eval login failed"),
        AgentClient(settings, transport=httpx.MockTransport(handler)),
    ):
        pytest.fail("Login failure must stop the run.")


def test_stream_preserves_failed_calls_and_retries_in_order() -> None:
    result = read_stream(
        stream(
            {
                "type": "tool-input-available",
                "toolCallId": "first",
                "toolName": "query_sql",
                "input": {"sql": "bad"},
            },
            {"type": "tool-output-error", "toolCallId": "first", "errorText": "Invalid SQL"},
            {
                "type": "tool-input-available",
                "toolCallId": "second",
                "toolName": "query_sql",
                "input": {"sql": "SELECT 1"},
            },
            {
                "type": "tool-output-available",
                "toolCallId": "second",
                "output": {"rows": [], "truncated": False},
            },
            {"type": "text-delta", "delta": "No matching "},
            {"type": "text-delta", "delta": "package."},
        )
    )
    assert result.text == "No matching package."
    assert [call["id"] for call in result.tools] == ["first", "second"]
    assert result.tools[0]["output"] == {"error": "Invalid SQL"}


def test_stream_errors_are_not_scored_as_answers() -> None:
    with pytest.raises(RuntimeError, match="Agent stream failed"):
        read_stream(stream({"type": "error", "errorText": "Model unavailable"}))


def test_incomplete_stream_is_rejected() -> None:
    with pytest.raises(RuntimeError, match="without"):
        read_stream(['data: {"type":"text-delta","delta":"Partial answer"}'])
    with pytest.raises(RuntimeError, match="unfinished"):
        read_stream(
            stream(
                {
                    "type": "tool-input-available",
                    "toolCallId": "call-1",
                    "toolName": "query_sql",
                    "input": {"sql": "SELECT 1"},
                },
                {"type": "text-delta", "delta": "Unfinished tool"},
            )
        )


def test_no_answer_failure_preserves_completed_tool_results() -> None:
    from harness.client import AgentRunError

    with pytest.raises(AgentRunError, match="no answer") as failure:
        read_stream(
            stream(
                {
                    "type": "tool-input-available",
                    "toolCallId": "query",
                    "toolName": "query_sql",
                    "input": {"sql": "SELECT 1"},
                },
                {
                    "type": "tool-output-available",
                    "toolCallId": "query",
                    "output": {"rows": [{"value": 1}]},
                },
            )
        )
    assert failure.value.result.tools[0]["output"] == {"rows": [{"value": 1}]}

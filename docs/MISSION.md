# Project vision

## Mission

Build an opinionated reference implementation for AI agents. Use a working web application to demonstrate how I believe production agentic systems should be built.

The application is a data agent based on lessons I've learned building AI systems in production. It uses React and assistant-ui for the user interface and AI SDK for the server-side agent. It persists conversations in a database, tests agent behavior with evals, and gives the agent a small set of tools.

Start with the simplest architecture that works. Design for reliability and evaluate agent behavior from the start. Add MCP, CodeMode, or sandboxed execution only when they solve a problem the application has demonstrated. Keep the project focused on building an application rather than creating an agent framework.

A developer should be able to run the project, inspect its code, question its decisions, and adapt it for their own agentic application.

## Intended developer audience

This project is for software engineers building or preparing to build AI agents as web applications.

It assumes familiarity with LLM APIs, tool calling, React, and backend development. It focuses on the decisions developers face when turning a demo into an application they can operate in production.

It addresses questions such as:

- How should I structure an agent inside a normal web application?
- What belongs in the frontend, backend, database, and agent loop?
- How should I persist conversations and agent state?
- What does a useful eval suite look like, and what should it measure?
- How do I make tool use observable, debuggable, and testable?
- When do I need MCP, CodeMode, sandboxing, or more complex infrastructure?
- How do I adopt these capabilities without turning my application into an agent framework of its own?

The project assumes the reader can build an application with React, SQL, and TypeScript and understands what an LLM does. It focuses on agent engineering rather than teaching those subjects from scratch.

Engineers building their first production agent should find implementation patterns they can use. Engineers who have shipped one should find explicit architecture and evaluation decisions they can compare with their own.

## Practical promise

The project must run as a working application.

A developer should be able to clone the repository, run the application, and ask the agent questions against real data. They should be able to run its evals and follow a request through the React interface, backend agent, and tool calls.

Demonstrate every major concept in executable code. Persist conversations using a database schema. Run evals against agent behavior and tools against a real data source. Make errors, retries, streaming, and intermediate agent work visible so developers can inspect what happened.

The agent runs as part of the backend application. Add infrastructure only when the application needs it. When introducing MCP, CodeMode, or sandboxed execution, show the problem it solves and explain the tradeoffs.

A developer should leave with code they can reuse and an understanding of why the application makes these choices.

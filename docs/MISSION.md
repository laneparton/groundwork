# Project vision

## Mission

Build a working agent harness on AI SDK for querying data inside a data warehouse through natural language. Use a complete web application to demonstrate how the harness provides context, guides tool use, handles failures, and produces answers grounded in query results. Start with a vanilla agent, evaluate it against real tasks, and make improvements measurable so developers can understand and reuse the resulting design.

The harness is based on lessons I've learned building AI systems in production. React and assistant-ui provide the user interface, and AI SDK runs the server-side agent. BigQuery and the deps.dev public dataset provide the first concrete implementation. Application architecture, conversation persistence, tool visibility, and evals support the central purpose: building a reliable harness for querying a data warehouse.

Start with the simplest architecture that works. Design for reliability and evaluate agent behavior from the start. Add MCP, CodeMode, or sandboxed execution only when they solve a problem the application has demonstrated. Build the harness through the needs of the working application. Introduce reusable abstractions as those needs become clear.

A developer should be able to run the project, inspect its code, question its decisions, and adapt the harness for their own data warehouse and application.

## Intended developer audience

This project is for software engineers building or preparing to build agents that query data warehouses through natural language.

It assumes familiarity with LLM APIs, tool calling, React, and backend development. It focuses on the decisions developers face when turning a demo into an application they can operate in production.

It addresses questions such as:

- What does a warehouse-querying harness need beyond a vanilla agent loop?
- How should I provide schema and data context to the agent?
- How should I structure the harness inside a normal web application?
- What belongs in the frontend, backend, database, and agent loop?
- How should I persist conversations and agent state?
- How should I evaluate query correctness and the answers produced from query results?
- Which harness changes improve quality, and what do they cost in latency and query usage?
- How do I make tool use observable, debuggable, and testable?
- When do I need MCP, CodeMode, sandboxing, or more complex infrastructure?
- How do I adopt these capabilities without turning my application into an agent framework of its own?

The project assumes the reader can build an application with React, SQL, and TypeScript and understands what an LLM does. It focuses on agent engineering rather than teaching those subjects from scratch.

Engineers building their first production agent should find implementation patterns they can use. Engineers who have shipped one should find explicit architecture and evaluation decisions they can compare with their own.

## Practical promise

The project must run as a working application.

A developer should be able to clone the repository, run the application, and ask the agent questions against real data. They should be able to run its evals and follow a request through the React interface, backend agent, and tool calls.

Keep a vanilla agent as a comparison baseline. Use representative tasks to expose its failures and measure the effect of each harness improvement. Demonstrate every major concept in executable code. Persist conversations using a database schema. Run evals against agent behavior and tools against a real data source. Make errors, retries, streaming, and intermediate agent work visible so developers can inspect what happened.

The agent runs as part of the backend application. Add infrastructure only when the application needs it. When introducing MCP, CodeMode, or sandboxed execution, show the problem it solves and explain the tradeoffs.

A developer should leave with a real warehouse-querying harness they can reuse, evidence of how it improves on the baseline, and an understanding of why it makes these choices.

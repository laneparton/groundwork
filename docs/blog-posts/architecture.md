# Groundwork: the initial architecture

Rough outline for the first post. Walk through the choices before the build, then revisit them as implementation provides evidence.

## 1. Why I'm building this

1. An opinionated, working reference implementation for an AI agent web application. I've now built two production chat experiences - and I have opinions.
2. I need a real-world, open-source playground to experiment and write about things. I want to build this from the ground up - from a basic chat completion to advanced RAG techniques. I want to explore advanced UI patterns and publish my lessons on them. All of this is unlocked by this open source project - and isn't locked down behind the work I do internally at my company.
3. I want to hone my craft - explore alternatives (with a purpose) - and keep thinking about how this evolves beyond 2026.
   - Example: I've never used Effect, but everyone is talking about it. Let's put it to work!

## 2. What the application will do

- A conversational data agent working with real deps.dev data.
- Demonstrate advanced techniques - some inspired by https://openai.com/index/inside-our-in-house-data-agent/

## 3. Follow one request through the architecture

- React interface sends an authenticated request to the backend.
- Effect HttpApi validates the request and calls the application services.
- AI SDK runs the agent and invokes tools backed by data services.
- Conversation storage preserves the relevant messages and execution state.
- The backend streams results and tool activity to the interface.
- Explain what belongs at each boundary: UI, HTTP contract, application services, agent, tools, and storage.
- Add the architecture diagram when these boundaries are settled.

## 4. Walk through the stack choices

### Frontend Layer: React, Vite, assistant-ui, shadcn, and Tailwind

- Why a SPA fits the application - and why I'm choosing it in 2026
  - The agent is basically a BFF.
  - No need to write server-rendered React in this setting. I still believe most enterprises are on SPA.
- What assistant-ui handles and what the application still needs to own.

### API Layer: Effect and Effect HttpApi

- Learning Effect is an explicit goal of this build.
  - Why choose HttpApi over Hono given that goal.
- Explore services, layers, typed errors, and control over execution through actual application needs.
- Validate AI SDK streaming, cancellation, and error handling during implementation.

### Agent Layer: AI SDK

- Its role: model interaction, tool calling, the agent loop, and streaming.
- Effect's role: application dependencies and tool execution.
- Explain their integration using one concrete tool once it exists.

### Data Layer: SQLite behind a storage interface

- SQLite makes the demo straightforward to run.
- The application depends on a conversation storage contract.
- Another data store can supply that contract by providing its own implementation.
- Show the contract and where the SQLite layer is supplied once implemented.

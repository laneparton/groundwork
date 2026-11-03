import { ConfigProvider } from 'effect'

// Runs Config reads against a fixed environment instead of process.env.
export const withEnv = (env: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env }))

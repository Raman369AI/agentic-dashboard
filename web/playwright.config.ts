import { defineConfig } from '@playwright/test'

const root = process.cwd().endsWith('/web') ? '..' : '.'
const apiEnv = { ALLOW_PRIVATE_AGENTS: 'true', REGISTRY_DB: `/tmp/relay-e2e-${process.pid}.db`, CORS_ORIGINS: 'http://127.0.0.1:5174' }

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5174', headless: true },
  webServer: [
    { command: 'uv run uvicorn examples.plugin_gateway:app --host 127.0.0.1 --port 9100', cwd: root, env: apiEnv, url: 'http://127.0.0.1:9100/api/health', reuseExistingServer: false },
    { command: 'uv run uvicorn examples.protocol_fixture:app --host 127.0.0.1 --port 9101', cwd: root, url: 'http://127.0.0.1:9101/openapi.json', reuseExistingServer: false },
    { command: 'uv run uvicorn examples.protocol_fixture:a2a_app --host 127.0.0.1 --port 9102', cwd: root, url: 'http://127.0.0.1:9102/.well-known/agent-card.json', reuseExistingServer: false },
    { command: process.env.RELAY_E2E_PREVIEW === '1' ? 'npm run build && npm exec vite -- preview --host 127.0.0.1 --port 5174 --strictPort' : 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort', env: { VITE_API_BASE_URL: 'http://127.0.0.1:9100' }, url: 'http://127.0.0.1:5174', reuseExistingServer: false },
  ],
})

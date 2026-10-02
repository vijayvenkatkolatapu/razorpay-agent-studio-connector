import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { ConnectorConfig } from './client/types.js';
import { WooCommerceClient } from './client/woocommerce.js';
import { TOOL_DEFINITIONS, handleToolCall } from './tools/index.js';
import { AgentPlanner } from './agent/planner.js';

import fs from 'fs';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Resolve public folder robustly whether in development, production, or cloud container
const publicPath = fs.existsSync(path.join(process.cwd(), 'public'))
  ? path.join(process.cwd(), 'public')
  : path.join(__dirname, '../public');
app.use(express.static(publicPath));

let currentMode = (process.env.CONNECTOR_MODE?.toLowerCase() === 'live' ? 'live' : 'mock') as 'live' | 'mock';

let config: ConnectorConfig = {
  mode: currentMode,
  woocommerceUrl: process.env.WOOCOMMERCE_URL,
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
  authMethod: (process.env.WOOCOMMERCE_AUTH_METHOD as any) || 'basic_auth',
  maxRequestsPerMinute: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_PER_MIN || '60', 10),
  maxRetries: parseInt(process.env.RATE_LIMIT_MAX_RETRIES || '4', 10),
  baseBackoffMs: parseInt(process.env.RATE_LIMIT_BASE_BACKOFF_MS || '500', 10),
  maxBackoffMs: parseInt(process.env.RATE_LIMIT_MAX_BACKOFF_MS || '8000', 10),
};

let client = new WooCommerceClient(config);
let planner = new AgentPlanner(client);

// -------------------------------------------------------------
// REST API Endpoints
// -------------------------------------------------------------

// Health & Status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    mode: config.mode,
    storeUrl: config.woocommerceUrl || 'https://sandbox.woocommerce.local',
    timestamp: new Date().toISOString(),
    metrics: client.rateLimiter.getMetrics(),
  });
});

// List MCP Tools
app.get('/api/tools', (req, res) => {
  res.json({
    tools: TOOL_DEFINITIONS,
  });
});

// Execute an MCP Tool directly
app.post('/api/tools/execute', async (req, res) => {
  const { name, arguments: args } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Tool name is required' });
  }

  const result = await handleToolCall(name, args || {}, client);
  res.json(result);
});

// Autonomous Agent Chat (Reasoning + Tool Calling)
app.post('/api/agent/chat', async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    const step = await planner.processQuery(message);
    res.json({
      success: true,
      ...step,
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || 'Error processing agent query',
    });
  }
});

// Get all orders for the Merchant Table view
app.get('/api/orders', async (req, res) => {
  try {
    const status = req.query.status as string | undefined;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const per_page = req.query.per_page ? parseInt(req.query.per_page as string, 10) : 20;

    const result = await client.listOrders({ page, per_page, status: status as any });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Real-time Rate Limiter Metrics
app.get('/api/metrics', (req, res) => {
  res.json(client.rateLimiter.getMetrics());
});

// Simulate Rate Limiting (HTTP 429) & Backoff
app.post('/api/simulate/throttle', async (req, res) => {
  const retryAfter = req.body.retryAfter ? parseInt(req.body.retryAfter, 10) : 1;
  const start = Date.now();

  try {
    const result = await client.simulateThrottledRequest(retryAfter);
    const elapsed = Date.now() - start;
    res.json({
      success: true,
      result,
      elapsedMs: elapsed,
      metrics: client.rateLimiter.getMetrics(),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      metrics: client.rateLimiter.getMetrics(),
    });
  }
});

// Update Configuration (Switch Live / Mock)
app.post('/api/config', (req, res) => {
  const { mode, woocommerceUrl, consumerKey, consumerSecret } = req.body;

  if (mode && (mode === 'live' || mode === 'mock')) {
    config.mode = mode;
  }
  if (woocommerceUrl) config.woocommerceUrl = woocommerceUrl;
  if (consumerKey) config.consumerKey = consumerKey;
  if (consumerSecret) config.consumerSecret = consumerSecret;

  try {
    client = new WooCommerceClient(config);
    planner = new AgentPlanner(client);
    res.json({ success: true, config: { mode: config.mode, woocommerceUrl: config.woocommerceUrl } });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`[WooCommerce-Connector] Server running at http://localhost:${PORT}`);
    console.log(`[WooCommerce-Connector] Mode: ${config.mode.toUpperCase()} | Tools: ${TOOL_DEFINITIONS.length} registered`);
    console.log(`[WooCommerce-Connector] Rate limiter: ${config.maxRequestsPerMinute} req/min token bucket active`);
  });
}

export default app;


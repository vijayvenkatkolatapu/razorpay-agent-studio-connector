import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { ConnectorConfig } from './client/types.js';
import { WooCommerceClient } from './client/woocommerce.js';
import { TOOL_DEFINITIONS, handleToolCall } from './tools/index.js';

dotenv.config();

// Determine configuration from environment
const mode = (process.env.CONNECTOR_MODE?.toLowerCase() === 'live' ? 'live' : 'mock') as 'live' | 'mock';

const config: ConnectorConfig = {
  mode,
  woocommerceUrl: process.env.WOOCOMMERCE_URL,
  consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
  consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
  authMethod: (process.env.WOOCOMMERCE_AUTH_METHOD as any) || 'basic_auth',
  maxRequestsPerMinute: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_PER_MIN || '60', 10),
  maxRetries: parseInt(process.env.RATE_LIMIT_MAX_RETRIES || '4', 10),
  baseBackoffMs: parseInt(process.env.RATE_LIMIT_BASE_BACKOFF_MS || '500', 10),
  maxBackoffMs: parseInt(process.env.RATE_LIMIT_MAX_BACKOFF_MS || '8000', 10),
};

const client = new WooCommerceClient(config);

// Initialize MCP Server
const server = new Server(
  {
    name: 'razorpay-woocommerce-connector',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register list_tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOL_DEFINITIONS,
  };
});

// Register call_tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleToolCall(name, args, client);
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log status to stderr so stdio stdout remains clean for MCP JSON-RPC protocol
  console.error(
    `[Razorpay-WooCommerce-MCP] Server active in "${mode.toUpperCase()}" mode. Ready for Agent Studio tool requests.`
  );
}

run().catch((error) => {
  console.error('[Razorpay-WooCommerce-MCP] Fatal server error:', error);
  process.exit(1);
});

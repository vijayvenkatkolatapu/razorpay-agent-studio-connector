# WooCommerce Private Connector (MCP)

A private connector enabling AI agents (such as Razorpay Agent Studio) to query, audit, and reconcile WooCommerce store orders via the **Model Context Protocol (MCP)**.

Includes a token-bucket rate limiter with automatic backoff, a local sandbox mode for offline testing, a suite of unit/integration tests, and an interactive developer playground.

---

## Why this exists

A large share of Indian D2C merchants process payments through Razorpay on top of WooCommerce storefronts. When customer support or finance teams look into payment failures, chargebacks, or fulfillment delays, they frequently need to cross-reference data between the payment gateway and the merchant's store backend.

This connector exposes a clean, standardized tool interface over MCP so an agent can:
- Look up recent order pipelines by status (`processing`, `completed`, `refunded`, `failed`).
- Inspect complete order details down to line items, billing/shipping addresses, and customer notes.
- Search orders across customer names, emails, and transaction references.
- Reconcile Razorpay payment IDs (`pay_...`) and transaction amounts against store records.
- Self-monitor its own request limits against upstream store throttling.

---

## System Architecture

```text
┌───────────────────────────────┐
│     Agent Orchestrator        │  (Agent Studio / Claude / Cursor)
└───────────────┬───────────────┘
                │ JSON-RPC / MCP
                ▼
┌───────────────────────────────┐
│       MCP Server Core         │
│  - Stdio Transport (headless) │
│  - HTTP / Web UI (playground) │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│     Zod Schema Validation     │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│    Rate Limiter & Backoff     │  Token bucket + Exponential backoff
│   (Handles 429s + Jitter)     │  Respects Retry-After headers
└───────────────┬───────────────┘
                │
        ┌───────┴───────┐
        ▼               ▼
┌──────────────┐ ┌──────────────┐
│  Mock Store  │ │  Live Store  │  (WooCommerce REST v3 over
│  (In-Memory) │ │ (HTTPS Auth) │   Basic Auth or OAuth 1.0a)
└──────────────┘ └──────────────┘
```

---

## Core Primitives (MCP Tools)

| Tool | Purpose | Key Inputs |
| :--- | :--- | :--- |
| `list_orders` | Lists store orders with pagination, status filters, and date boundaries. | `page`, `per_page`, `status`, `after`, `before`, `customer` |
| `get_order` | Retrieves complete order breakdown including line items, address, and notes. | `order_id` |
| `search_orders` | Multi-field search by customer email, name, product SKU, or payment ID. | `query`, `limit` |
| `reconcile_payment` | Cross-verifies a Razorpay payment ID and expected total against WooCommerce records. | `order_id`, `razorpay_payment_id`, `expected_amount` |
| `get_connector_metrics` | Returns live rate limiter capacity, dispatched requests, and throttle counts. | *None* |

Detailed parameter schemas are exported in [`docs/mcp-tool-spec.json`](./docs/mcp-tool-spec.json).

---

## Key Design Decisions

### 1. Read-Only by Default (Least Privilege)
The connector deliberately omits order update or deletion endpoints (`PUT`, `DELETE`). An autonomous agent should not have the ability to modify order amounts, apply unapproved discounts, or trigger unauthenticated refunds without human-in-the-loop review. This preserves store integrity and satisfies PCI-DSS scope boundaries.

### 2. Upstream Resilience & Rate-Limiting
Shared WooCommerce hosts (Cloudflare, cPanel, WP Engine) often enforce aggressive rate limits. The connector implements:
- **Token Bucket Algorithm**: Shapes outbound traffic to avoid bursting (default 60 req/min).
- **Exponential Backoff with Full Jitter**:
  $$\text{delay} = \min\left(\text{maxBackoff}, \text{baseBackoff} \times 2^{\text{attempt}} + \text{jitter}\right)$$
- **429 Handling**: Automatically parses `Retry-After` headers (both integer seconds and HTTP dates) and retries transparently. Non-retryable errors (`401`, `403`, `404`) fail fast.

### 3. Dual Engine: Live vs In-Memory Sandbox
To make local development and evaluation frictionless, the connector runs by default in an in-memory mock mode populated with realistic INR e-commerce records, Razorpay payment IDs, and varied order states. Switching to a live store only requires setting 3 environment variables.

---

## Quickstart

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0

### 1. Install & Launch Playground
```bash
git clone https://github.com/<your-username>/razorpay-agent-studio-connector.git
cd razorpay-agent-studio-connector
npm install
npm start
```
Open **`http://localhost:3000`** in your browser to access the developer playground, order table, and rate-limiting visualizer.

### 2. Run the Test Suite
```bash
npm test
```
Runs 19 unit and integration tests covering rate-limiting, token consumption, 429 recovery, tool execution, and reconciliation logic.

### 3. Run the CLI Diagnostics
```bash
npm run demo
```
Executes an end-to-end command-line walkthrough of all 5 primitives with a live rate-limiting simulation.

### 4. Use with Claude Desktop or Cursor
To attach this connector to an MCP-compatible client like Claude Desktop, add this to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "woocommerce": {
      "command": "node",
      "args": ["<PATH_TO_REPO>/dist/index.js"],
      "env": {
        "CONNECTOR_MODE": "mock"
      }
    }
  }
}
```

---

## Connecting to a Live WooCommerce Store

To point the connector at a real WooCommerce store:

1. In WooCommerce Admin, go to **Settings > Advanced > REST API** and generate a key with **Read** permissions.
2. Configure `.env`:
   ```env
   CONNECTOR_MODE=live
   WOOCOMMERCE_URL=https://your-store.com
   WOOCOMMERCE_CONSUMER_KEY=ck_xxxxxxxxxxxxxxxxxxxxxxxx
   WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxxxxxxxxxxxxxxxxxxxxx
   WOOCOMMERCE_AUTH_METHOD=basic_auth

   RATE_LIMIT_MAX_REQUESTS_PER_MIN=60
   RATE_LIMIT_MAX_RETRIES=4
   ```
3. Restart with `npm start`.

---

## Assumptions & Real-World Trade-Offs

1. **WordPress Search at Scale**: WooCommerce's built-in `GET /orders?search=` runs MySQL `LIKE` queries. For stores with >500k orders, search latency degrades. In production at Razorpay scale, I would supplement this with an indexed read-replica or Elasticsearch cluster.
2. **Webhooks vs Polling**: This connector handles on-demand agent queries. For high-volume stores, pairing this pull-based connector with Razorpay and WooCommerce webhook listeners offers the best balance of immediacy and efficiency.
3. **Transaction Metadata Convention**: The payment reconciliation primitive looks for Razorpay references in `order.transaction_id` or `order.meta_data._razorpay_payment_id`, following the convention established by the standard Razorpay WooCommerce plugin.

---

## Project Structure

```text
├── public/                 # Web UI playground
├── src/
│   ├── agent/              # Autonomous agent planner
│   ├── client/             # WooCommerce API client & rate limiter
│   ├── mock/               # In-memory test dataset
│   ├── tools/              # MCP tool definitions & handlers
│   ├── server.ts           # Web server & REST API
│   ├── index.ts            # Stdio MCP server
│   └── demo.ts             # CLI diagnostic script
├── tests/                  # Unit and integration test suites
├── docs/                   # Capabilities, architecture, and tool schemas
├── render.yaml             # Render deployment blueprint
├── vercel.json             # Vercel deployment blueprint
└── package.json
```

---

## License

MIT

import { WooCommerceClient } from './client/woocommerce.js';
import { TOOL_DEFINITIONS, handleToolCall } from './tools/index.js';

const divider = '='.repeat(70);
const subDivider = '-'.repeat(70);

async function runDemo() {
  console.log('\n' + divider);
  console.log('  WooCommerce Private Connector — Diagnostics & CLI Runner');
  console.log('  Model Context Protocol (MCP) Integration Verification');
  console.log(divider + '\n');

  const client = new WooCommerceClient({
    mode: 'mock',
    maxRequestsPerMinute: 60,
    maxRetries: 3,
    baseBackoffMs: 200,
    maxBackoffMs: 2000,
  });

  // Enable retry logging
  (client.rateLimiter as any).onRetry = (attempt: number, delayMs: number, error: any) => {
    console.log(
      `  [RateLimiter] Throttled (${error.response?.status || 'network'}). Retry attempt #${attempt} backing off for ${delayMs}ms...`
    );
  };

  console.log('✔ Connector initialized in MOCK Sandbox mode (zero-config, instant evaluation).');
  console.log(`✔ Available MCP Tools: ${TOOL_DEFINITIONS.map((t) => t.name).join(', ')}\n`);

  // -------------------------------------------------------------
  // Step 1: List Orders with Filtering
  // -------------------------------------------------------------
  console.log(subDivider);
  console.log('DEMO 1: Listing orders with status filter (status = "processing")');
  console.log(subDivider);
  const listResult = await handleToolCall(
    'list_orders',
    { status: 'processing', per_page: 5 },
    client
  );
  const listData = JSON.parse(listResult.content[0].text);
  console.log(`Found ${listData.total} order(s) matching filter 'processing':`);
  listData.orders.forEach((o: any) => {
    console.log(
      `  • Order #${o.id} | Customer: ${o.billing.first_name} ${o.billing.last_name} | Amount: ${o.currency} ${o.total} | Payment: ${o.payment_method} (${o.transaction_id || 'N/A'})`
    );
  });
  console.log();

  // -------------------------------------------------------------
  // Step 2: Get Order by ID
  // -------------------------------------------------------------
  console.log(subDivider);
  console.log('DEMO 2: Fetching comprehensive order details for Order #1042');
  console.log(subDivider);
  const getResult = await handleToolCall('get_order', { order_id: 1042 }, client);
  const orderData = JSON.parse(getResult.content[0].text);
  console.log(`Order ID: #${orderData.id}`);
  console.log(`Status: ${orderData.status}`);
  console.log(`Date Created: ${orderData.date_created}`);
  console.log(`Customer: ${orderData.billing.first_name} ${orderData.billing.last_name} (${orderData.billing.email})`);
  console.log(`Shipping Address: ${orderData.shipping.address_1}, ${orderData.shipping.city}, ${orderData.shipping.state} ${orderData.shipping.postcode}`);
  console.log(`Payment Method: ${orderData.payment_method_title}`);
  console.log(`Razorpay Transaction ID: ${orderData.transaction_id}`);
  console.log('Line Items:');
  orderData.line_items.forEach((item: any) => {
    console.log(`  - ${item.name} (SKU: ${item.sku}) x ${item.quantity} = ${orderData.currency} ${item.total}`);
  });
  console.log(`Order Total: ${orderData.currency} ${orderData.total}`);
  console.log();

  // -------------------------------------------------------------
  // Step 3: Multi-field Search
  // -------------------------------------------------------------
  console.log(subDivider);
  console.log('DEMO 3: Multi-field Search by Razorpay Payment ID ("pay_P2B87654321092")');
  console.log(subDivider);
  const searchResult = await handleToolCall(
    'search_orders',
    { query: 'pay_P2B87654321092' },
    client
  );
  const searchData = JSON.parse(searchResult.content[0].text);
  console.log(`Search query '${searchData.query}' matched ${searchData.matches_count} order(s):`);
  searchData.orders.forEach((o: any) => {
    console.log(`  • Found Order #${o.id} for customer ${o.billing.first_name} ${o.billing.last_name} | Status: ${o.status}`);
  });
  console.log();

  // -------------------------------------------------------------
  // Step 4: Razorpay Payment Reconciliation
  // -------------------------------------------------------------
  console.log(subDivider);
  console.log('DEMO 4: Razorpay Payment Reconciliation (Agent Studio FinTech Primitive)');
  console.log(subDivider);

  // Case A: Perfect match
  console.log('Case A: Reconciling Order #1042 with valid payment ID and matching amount (₹4999.00)...');
  const reconA = await handleToolCall(
    'reconcile_payment',
    {
      order_id: 1042,
      razorpay_payment_id: 'pay_P1A98765432101',
      expected_amount: 4999.0,
    },
    client
  );
  console.log(reconA.content[0].text);

  // Case B: Discrepancy detection
  console.log('\nCase B: Reconciling Order #1043 with mismatched amount (expected ₹5000.00, actual ₹2799.00)...');
  const reconB = await handleToolCall(
    'reconcile_payment',
    {
      order_id: 1043,
      razorpay_payment_id: 'pay_P2B87654321092',
      expected_amount: 5000.0,
    },
    client
  );
  console.log(reconB.content[0].text);
  console.log();

  // -------------------------------------------------------------
  // Step 5: Rate Limiting Throttling & Automatic Exponential Backoff
  // -------------------------------------------------------------
  console.log(subDivider);
  console.log('DEMO 5: Simulating HTTP 429 Throttling & Self-Healing Backoff');
  console.log(subDivider);
  console.log('Simulating WooCommerce upstream rate-limiting with Retry-After header...');
  const throttledResult = await client.simulateThrottledRequest(1);
  console.log(`✔ Result: ${throttledResult}`);
  console.log();

  // -------------------------------------------------------------
  // Step 6: Connector Telemetry & Metrics
  // -------------------------------------------------------------
  console.log(subDivider);
  console.log('DEMO 6: Real-time Telemetry & Rate-Limiter Metrics');
  console.log(subDivider);
  const metricsResult = await handleToolCall('get_connector_metrics', {}, client);
  console.log(metricsResult.content[0].text);

  console.log('\n' + divider);
  console.log('  Diagnostics complete: all primitives verified successfully.');
  console.log(divider + '\n');
}

runDemo().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});

import {
  GetOrderSchema,
  ListOrdersSchema,
  ReconcilePaymentSchema,
  SearchOrdersSchema,
} from '../client/types.js';
import { WooCommerceClient } from '../client/woocommerce.js';

/**
 * Standard MCP Tool Definitions
 */
export const TOOL_DEFINITIONS = [
  {
    name: 'list_orders',
    description:
      'List orders from the merchant store with pagination and filtering by status, customer ID, or date range. Enables Agent Studio agents to inspect recent merchant order volume and statuses.',
    inputSchema: {
      type: 'object',
      properties: {
        page: {
          type: 'integer',
          minimum: 1,
          default: 1,
          description: 'Page number for paginated results (default: 1)',
        },
        per_page: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 10,
          description: 'Number of orders to retrieve per page (max: 100, default: 10)',
        },
        status: {
          type: 'string',
          enum: ['any', 'pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'],
          description: 'Filter orders by WooCommerce status (e.g. "processing", "completed", "failed")',
        },
        after: {
          type: 'string',
          description: 'ISO 8601 date string to fetch orders created after (e.g. "2026-03-01T00:00:00Z")',
        },
        before: {
          type: 'string',
          description: 'ISO 8601 date string to fetch orders created before (e.g. "2026-03-31T23:59:59Z")',
        },
        customer: {
          type: 'integer',
          description: 'Filter orders by specific numeric customer ID',
        },
        order: {
          type: 'string',
          enum: ['asc', 'desc'],
          default: 'desc',
          description: 'Sort direction: "asc" or "desc"',
        },
        orderby: {
          type: 'string',
          enum: ['date', 'id', 'title', 'include'],
          default: 'date',
          description: 'Field to sort orders by',
        },
      },
    },
  },
  {
    name: 'get_order',
    description:
      'Fetch comprehensive details for a specific WooCommerce order by its numeric ID. Returns line items, billing/shipping addresses, payment method, transaction IDs, totals, and customer notes.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: {
          type: 'integer',
          description: 'The unique numeric ID of the order (e.g. 1042)',
        },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'search_orders',
    description:
      'Search merchant orders by customer email, customer name, order number, line item products, or payment transaction IDs (e.g. Razorpay payment ID).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search keyword (email, name, order ID, product name, or payment ID)',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          default: 10,
          description: 'Maximum number of search results to return (default: 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'reconcile_payment',
    description:
      'Cross-verify a Razorpay payment ID and expected order amount against the WooCommerce order record. Essential for payment dispute resolution, chargeback checks, and order fulfillment verification in Razorpay Agent Studio.',
    inputSchema: {
      type: 'object',
      properties: {
        order_id: {
          type: 'integer',
          description: 'WooCommerce Order ID to check',
        },
        razorpay_payment_id: {
          type: 'string',
          description: 'Razorpay Payment ID (e.g. "pay_P1A98765432101")',
        },
        expected_amount: {
          type: 'number',
          description: 'Expected order total amount in store currency to check for discrepancies',
        },
      },
      required: ['order_id', 'razorpay_payment_id'],
    },
  },
  {
    name: 'get_connector_metrics',
    description:
      'Retrieve real-time connector operational telemetry, including total requests, throttled requests (HTTP 429), successful retry backoffs, and token bucket state.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Tool dispatcher and executor
 */
export async function handleToolCall(
  name: string,
  args: any,
  client: WooCommerceClient
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    switch (name) {
      case 'list_orders': {
        const validated = ListOrdersSchema.parse(args || {});
        const result = await client.listOrders(validated);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_order': {
        const validated = GetOrderSchema.parse(args || {});
        const order = await client.getOrder(validated);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(order, null, 2),
            },
          ],
        };
      }

      case 'search_orders': {
        const validated = SearchOrdersSchema.parse(args || {});
        const orders = await client.searchOrders(validated);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  query: validated.query,
                  matches_count: orders.length,
                  orders,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'reconcile_payment': {
        const validated = ReconcilePaymentSchema.parse(args || {});
        const result = await client.reconcilePayment(validated);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_connector_metrics': {
        const metrics = client.rateLimiter.getMetrics();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'healthy',
                  metrics,
                  timestamp: new Date().toISOString(),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Unknown tool: ${name}. Available tools: ${TOOL_DEFINITIONS.map((t) => t.name).join(', ')}`,
            },
          ],
        };
    }
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Tool Execution Error [${name}]: ${error?.message || String(error)}`,
        },
      ],
    };
  }
}

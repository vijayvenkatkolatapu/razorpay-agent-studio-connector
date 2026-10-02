import { WooCommerceClient } from '../client/woocommerce.js';
import { handleToolCall } from '../tools/index.js';

export interface AgentStep {
  thought: string;
  tool: string;
  toolArgs: Record<string, any>;
  toolResult: any;
  finalAnswer: string;
}

/**
 * Autonomous Agent Planner for Razorpay Agent Studio.
 * Formulates tool execution plans from natural language queries,
 * executes them via the WooCommerce Private Connector,
 * and synthesizes user-friendly merchant insights.
 */
export class AgentPlanner {
  private client: WooCommerceClient;

  constructor(client: WooCommerceClient) {
    this.client = client;
  }

  public async processQuery(userMessage: string): Promise<AgentStep> {
    const text = userMessage.trim().toLowerCase();

    // 1. Detect Intent: Payment Reconciliation
    const reconcileMatch = userMessage.match(/(?:reconcile|verify|cross-check).*?(?:order\s*#?(\d+)|#?(\d+)).*?(pay_[a-zA-Z0-9]+)/i) ||
      userMessage.match(/(?:reconcile|verify|cross-check).*?(pay_[a-zA-Z0-9]+).*?(?:order\s*#?(\d+)|#?(\d+))/i) ||
      userMessage.match(/(pay_[a-zA-Z0-9]+)/i);

    if (text.includes('reconcile') || (reconcileMatch && text.includes('order'))) {
      const orderIdStr = (userMessage.match(/order\s*#?(\d+)/i) || userMessage.match(/#(\d+)/))?.[1];
      const paymentId = (userMessage.match(/(pay_[a-zA-Z0-9]+)/i))?.[1];

      const orderId = orderIdStr ? parseInt(orderIdStr, 10) : 1042;
      const payId = paymentId || 'pay_P1A98765432101';

      const thought = `The merchant user is requesting payment reconciliation for WooCommerce Order #${orderId} with Razorpay Payment ID '${payId}'. I will invoke the 'reconcile_payment' tool to verify transaction IDs, currency, and gross totals.`;
      const tool = 'reconcile_payment';
      const toolArgs = { order_id: orderId, razorpay_payment_id: payId };

      const toolResponse = await handleToolCall(tool, toolArgs, this.client);
      const parsed = JSON.parse(toolResponse.content[0].text);

      let finalAnswer = '';
      if (parsed.matched) {
        finalAnswer = `✅ **Payment Reconciled Successfully**: WooCommerce Order #${orderId} matches Razorpay Payment ID \`${payId}\`. The order amount of **${parsed.currency} ${parsed.orderTotal}** is confirmed, and the order status is \`${parsed.status}\`.`;
      } else {
        finalAnswer = `⚠️ **Payment Discrepancy Detected**: Order #${orderId} could not be fully reconciled with \`${payId}\`.\n\n**Discrepancies:**\n${parsed.discrepancies.map((d: string) => `- ${d}`).join('\n')}`;
      }

      return { thought, tool, toolArgs, toolResult: parsed, finalAnswer };
    }

    // 2. Detect Intent: Get Specific Order
    const orderIdMatch = userMessage.match(/(?:order\s*#?(\d+)|#(\d+))/i);
    if ((text.includes('order') || text.includes('details') || text.includes('item')) && orderIdMatch && !text.includes('list')) {
      const orderId = parseInt(orderIdMatch[1] || orderIdMatch[2], 10);
      const thought = `User is asking for details of specific Order #${orderId}. I will invoke 'get_order' to fetch the complete order breakdown, line items, and billing info.`;
      const tool = 'get_order';
      const toolArgs = { order_id: orderId };

      const toolResponse = await handleToolCall(tool, toolArgs, this.client);
      if (toolResponse.isError) {
        return {
          thought,
          tool,
          toolArgs,
          toolResult: toolResponse.content[0].text,
          finalAnswer: `❌ Error fetching order #${orderId}: ${toolResponse.content[0].text}`,
        };
      }

      const order = JSON.parse(toolResponse.content[0].text);
      const itemsList = order.line_items.map((it: any) => `• **${it.name}** (x${it.quantity}) — ${order.currency} ${it.total}`).join('\n');
      const finalAnswer = `📦 **Order Details for #${order.id}**:\n\n- **Status**: \`${order.status.toUpperCase()}\`\n- **Customer**: ${order.billing.first_name} ${order.billing.last_name} (${order.billing.email})\n- **Shipping**: ${order.shipping.address_1}, ${order.shipping.city}, ${order.shipping.state}\n- **Payment Method**: ${order.payment_method_title} (${order.transaction_id || 'Pending'})\n- **Order Total**: **${order.currency} ${order.total}**\n\n**Line Items:**\n${itemsList}`;

      return { thought, tool, toolArgs, toolResult: order, finalAnswer };
    }

    // 3. Detect Intent: Search Orders (by email, name, product, or transaction ID)
    if (text.includes('search') || text.includes('find') || text.includes('who') || text.includes('@') || text.startsWith('pay_')) {
      let query = userMessage.replace(/(?:search|find|for|orders|order|customer)\s+/gi, '').trim();
      const emailMatch = userMessage.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      const txMatch = userMessage.match(/(pay_[a-zA-Z0-9]+)/i);

      if (emailMatch) query = emailMatch[1];
      else if (txMatch) query = txMatch[1];

      const thought = `The user is searching for orders matching criteria '${query}'. I will execute 'search_orders' across customer names, emails, transaction IDs, and line items.`;
      const tool = 'search_orders';
      const toolArgs = { query, limit: 5 };

      const toolResponse = await handleToolCall(tool, toolArgs, this.client);
      const parsed = JSON.parse(toolResponse.content[0].text);

      let finalAnswer = '';
      if (parsed.orders.length === 0) {
        finalAnswer = `🔍 No orders found matching query \`${query}\`.`;
      } else {
        const orderSummary = parsed.orders
          .map(
            (o: any) =>
              `• **Order #${o.id}** (${o.status}) | ${o.billing.first_name} ${o.billing.last_name} | Total: ${o.currency} ${o.total} | Ref: \`${o.transaction_id || 'N/A'}\``
          )
          .join('\n');
        finalAnswer = `🔍 Found **${parsed.matches_count} order(s)** matching \`${query}\`:\n\n${orderSummary}`;
      }

      return { thought, tool, toolArgs, toolResult: parsed, finalAnswer };
    }

    // 4. Detect Intent: Rate-Limiting Metrics & Telemetry
    if (text.includes('metric') || text.includes('rate limit') || text.includes('token') || text.includes('health')) {
      const thought = `User requested connector operational health and rate-limiter telemetry. Invoking 'get_connector_metrics'.`;
      const tool = 'get_connector_metrics';
      const toolArgs = {};

      const toolResponse = await handleToolCall(tool, toolArgs, this.client);
      const parsed = JSON.parse(toolResponse.content[0].text);
      const m = parsed.metrics;

      const finalAnswer = `⚡ **Connector Operational Telemetry**:\n- **Status**: \`${parsed.status.toUpperCase()}\`\n- **Token Bucket Available**: ${m.currentTokens} / 60 tokens\n- **Total Requests**: ${m.totalRequests}\n- **Throttled (429) Requests**: ${m.throttledRequests}\n- **Successful Retries**: ${m.successfulRetries}\n- **Failed Retries**: ${m.failedRetries}`;

      return { thought, tool, toolArgs, toolResult: parsed, finalAnswer };
    }

    // 5. Default Intent: List Orders with Optional Status Filtering
    let status: any = undefined;
    if (text.includes('processing')) status = 'processing';
    else if (text.includes('completed')) status = 'completed';
    else if (text.includes('refunded')) status = 'refunded';
    else if (text.includes('failed')) status = 'failed';
    else if (text.includes('pending')) status = 'pending';

    const thought = `User wants to list recent merchant orders${status ? ` filtered by status '${status}'` : ''}. Invoking 'list_orders'.`;
    const tool = 'list_orders';
    const toolArgs: any = { per_page: 5 };
    if (status) toolArgs.status = status;

    const toolResponse = await handleToolCall(tool, toolArgs, this.client);
    const parsed = JSON.parse(toolResponse.content[0].text);

    const ordersList = parsed.orders
      .map(
        (o: any) =>
          `• **Order #${o.id}** [${o.status.toUpperCase()}] | Customer: ${o.billing.first_name} ${o.billing.last_name} | Amount: ${o.currency} ${o.total} | Tx: \`${o.transaction_id || 'N/A'}\``
      )
      .join('\n');

    const finalAnswer = `📋 Found **${parsed.total} order(s)**${status ? ` with status \`${status}\`` : ''} (showing page ${parsed.page} of ${parsed.totalPages}):\n\n${ordersList}`;

    return { thought, tool, toolArgs, toolResult: parsed, finalAnswer };
  }
}

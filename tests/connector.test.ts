import { describe, it, expect } from 'vitest';
import { WooCommerceClient } from '../src/client/woocommerce.js';
import { handleToolCall, TOOL_DEFINITIONS } from '../src/tools/index.js';

describe('WooCommerceClient & MCP Tools', () => {
  const client = new WooCommerceClient({ mode: 'mock' });

  describe('listOrders primitive', () => {
    it('should list all orders with default pagination', async () => {
      const result = await client.listOrders({ page: 1, per_page: 10, order: 'desc', orderby: 'date' });
      expect(result.orders.length).toBeGreaterThan(0);
      expect(result.total).toBe(6);
      expect(result.page).toBe(1);
    });

    it('should filter orders by status', async () => {
      const result = await client.listOrders({
        page: 1,
        per_page: 10,
        status: 'processing',
        order: 'desc',
        orderby: 'date',
      });
      expect(result.orders.length).toBe(2);
      expect(result.orders.every((o) => o.status === 'processing')).toBe(true);
    });

    it('should filter orders by customer ID', async () => {
      const result = await client.listOrders({
        page: 1,
        per_page: 10,
        customer: 201,
        order: 'desc',
        orderby: 'date',
      });
      expect(result.orders.length).toBe(2);
      expect(result.orders.every((o) => o.customer_id === 201)).toBe(true);
    });
  });

  describe('getOrder primitive', () => {
    it('should retrieve a valid order by ID', async () => {
      const order = await client.getOrder({ order_id: 1042 });
      expect(order.id).toBe(1042);
      expect(order.billing.email).toBe('aarav.sharma@example.com');
      expect(order.line_items.length).toBe(1);
      expect(order.line_items[0].sku).toBe('ANC-HP-BLK');
    });

    it('should throw a 404 error when order is not found', async () => {
      await expect(client.getOrder({ order_id: 99999 })).rejects.toThrow('Order with ID #99999 not found');
    });
  });

  describe('searchOrders primitive', () => {
    it('should search by customer email', async () => {
      const orders = await client.searchOrders({ query: 'priya.nair@example.com', limit: 10 });
      expect(orders.length).toBe(1);
      expect(orders[0].id).toBe(1043);
    });

    it('should search by product name in line items', async () => {
      const orders = await client.searchOrders({ query: 'Headphones', limit: 10 });
      expect(orders.length).toBe(1);
      expect(orders[0].id).toBe(1042);
    });

    it('should search by Razorpay payment ID', async () => {
      const orders = await client.searchOrders({ query: 'pay_P1A98765432101', limit: 10 });
      expect(orders.length).toBe(1);
      expect(orders[0].id).toBe(1042);
    });
  });

  describe('reconcilePayment primitive', () => {
    it('should verify matching payment ID and amount', async () => {
      const recon = await client.reconcilePayment({
        order_id: 1042,
        razorpay_payment_id: 'pay_P1A98765432101',
        expected_amount: 4999.0,
      });

      expect(recon.matched).toBe(true);
      expect(recon.discrepancies.length).toBe(0);
      expect(recon.amountMatch).toBe(true);
    });

    it('should flag discrepancy when expected amount does not match', async () => {
      const recon = await client.reconcilePayment({
        order_id: 1042,
        razorpay_payment_id: 'pay_P1A98765432101',
        expected_amount: 2500.0,
      });

      expect(recon.matched).toBe(false);
      expect(recon.discrepancies.length).toBeGreaterThan(0);
      expect(recon.amountMatch).toBe(false);
    });
  });

  describe('MCP handleToolCall dispatcher', () => {
    it('should expose tool definitions', () => {
      const toolNames = TOOL_DEFINITIONS.map((t) => t.name);
      expect(toolNames).toContain('list_orders');
      expect(toolNames).toContain('get_order');
      expect(toolNames).toContain('search_orders');
      expect(toolNames).toContain('reconcile_payment');
      expect(toolNames).toContain('get_connector_metrics');
    });

    it('should execute list_orders through MCP tool handler', async () => {
      const response = await handleToolCall('list_orders', { per_page: 2 }, client);
      expect(response.isError).toBeFalsy();
      const parsed = JSON.parse(response.content[0].text);
      expect(parsed.orders.length).toBe(2);
    });

    it('should return isError: true on unknown tool names', async () => {
      const response = await handleToolCall('unknown_tool', {}, client);
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Unknown tool: unknown_tool');
    });

    it('should validate inputs with Zod and return error on invalid type', async () => {
      const response = await handleToolCall('get_order', { order_id: 'invalid-id' }, client);
      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Tool Execution Error');
    });
  });
});

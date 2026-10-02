import { z } from 'zod';

/**
 * WooCommerce Order Statuses
 */
export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'on-hold'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | 'failed'
  | 'trash';

/**
 * Line item inside a WooCommerce order
 */
export interface OrderLineItem {
  id: number;
  name: string;
  product_id: number;
  variation_id?: number;
  quantity: number;
  subtotal: string;
  total: string;
  sku?: string;
  price: number;
}

/**
 * Address details for billing / shipping
 */
export interface AddressDetails {
  first_name: string;
  last_name: string;
  company?: string;
  address_1: string;
  address_2?: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  email?: string;
  phone?: string;
}

/**
 * Payment details associated with the order
 */
export interface PaymentDetails {
  payment_method: string;
  payment_method_title: string;
  transaction_id: string;
  date_paid?: string | null;
  paid: boolean;
}

/**
 * Full WooCommerce Order object
 */
export interface WooCommerceOrder {
  id: number;
  number: string;
  status: OrderStatus;
  currency: string;
  date_created: string;
  date_modified: string;
  discount_total: string;
  shipping_total: string;
  total: string;
  total_tax: string;
  customer_id: number;
  customer_note?: string;
  billing: AddressDetails;
  shipping: AddressDetails;
  payment_method: string;
  payment_method_title: string;
  transaction_id: string;
  date_paid: string | null;
  date_completed: string | null;
  line_items: OrderLineItem[];
  meta_data?: Array<{ key: string; value: any }>;
}

/**
 * Input parameters for listing orders
 */
export const ListOrdersSchema = z.object({
  page: z.number().int().min(1).default(1).describe('Page number of results to fetch (default: 1)'),
  per_page: z.number().int().min(1).max(100).default(10).describe('Number of orders per page (max: 100, default: 10)'),
  status: z
    .enum(['any', 'pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'])
    .optional()
    .describe('Filter orders by status (e.g. "processing", "completed", "failed")'),
  after: z.string().optional().describe('ISO 8601 date string to fetch orders created after (e.g. 2026-01-01T00:00:00Z)'),
  before: z.string().optional().describe('ISO 8601 date string to fetch orders created before (e.g. 2026-03-31T23:59:59Z)'),
  customer: z.number().int().optional().describe('Filter by specific customer ID'),
  order: z.enum(['asc', 'desc']).default('desc').describe('Sort order: "asc" or "desc" (default: "desc")'),
  orderby: z.enum(['date', 'id', 'title', 'include']).default('date').describe('Sort field (default: "date")'),
});

export type ListOrdersParams = z.input<typeof ListOrdersSchema>;

/**
 * Input parameters for fetching a single order
 */
export const GetOrderSchema = z.object({
  order_id: z.number().int().positive().describe('Unique numeric WooCommerce Order ID (e.g. 1042)'),
});

export type GetOrderParams = z.infer<typeof GetOrderSchema>;

/**
 * Input parameters for searching orders
 */
export const SearchOrdersSchema = z.object({
  query: z.string().min(1).describe('Search term: customer email, customer name, transaction/payment ID, or product name'),
  limit: z.number().int().min(1).max(50).default(10).describe('Maximum matching orders to return (default: 10)'),
});

export type SearchOrdersParams = z.infer<typeof SearchOrdersSchema>;

/**
 * Input parameters for payment reconciliation (Razorpay Agent Studio special feature)
 */
export const ReconcilePaymentSchema = z.object({
  order_id: z.number().int().positive().describe('WooCommerce Order ID'),
  razorpay_payment_id: z.string().min(5).describe('Razorpay Payment ID (e.g. "pay_N0B7vKx1234567")'),
  expected_amount: z.number().positive().optional().describe('Expected order total in store currency for cross-verification'),
});

export type ReconcilePaymentParams = z.infer<typeof ReconcilePaymentSchema>;

/**
 * Connector configuration options
 */
export interface ConnectorConfig {
  mode: 'mock' | 'live';
  woocommerceUrl?: string;
  consumerKey?: string;
  consumerSecret?: string;
  authMethod?: 'basic_auth' | 'oauth1';
  maxRequestsPerMinute?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
}

import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import {
  ConnectorConfig,
  GetOrderParams,
  ListOrdersParams,
  ReconcilePaymentParams,
  SearchOrdersParams,
  WooCommerceOrder,
} from './types.js';
import { RateLimiter } from './rate-limiter.js';
import { MOCK_ORDERS } from '../mock/fixtures.js';

export interface ListOrdersResult {
  orders: WooCommerceOrder[];
  total: number;
  totalPages: number;
  page: number;
  per_page: number;
}

export interface ReconciliationResult {
  matched: boolean;
  orderId: number;
  paymentId: string;
  status: string;
  currency: string;
  orderTotal: string;
  amountMatch?: boolean;
  notes: string[];
  discrepancies: string[];
}

/**
 * Production-ready WooCommerce Client supporting both Live REST API (v3)
 * and an In-Memory Sandbox Mock mode for zero-config evaluation.
 */
export class WooCommerceClient {
  private config: ConnectorConfig;
  private httpClient?: AxiosInstance;
  public rateLimiter: RateLimiter;
  private mockDataset: WooCommerceOrder[];

  constructor(config: ConnectorConfig) {
    this.config = config;
    this.mockDataset = JSON.parse(JSON.stringify(MOCK_ORDERS));

    this.rateLimiter = new RateLimiter({
      maxRequestsPerMinute: config.maxRequestsPerMinute ?? 60,
      maxRetries: config.maxRetries ?? 4,
      baseBackoffMs: config.baseBackoffMs ?? 500,
      maxBackoffMs: config.maxBackoffMs ?? 8000,
    });

    if (config.mode === 'live') {
      this.initLiveClient();
    }
  }

  /**
   * Initializes Axios client for Live WooCommerce REST API v3
   */
  private initLiveClient(): void {
    if (!this.config.woocommerceUrl) {
      throw new Error('WOOCOMMERCE_URL is required when running in live mode');
    }
    if (!this.config.consumerKey || !this.config.consumerSecret) {
      throw new Error('WOOCOMMERCE_CONSUMER_KEY and WOOCOMMERCE_CONSUMER_SECRET are required in live mode');
    }

    const baseURL = `${this.config.woocommerceUrl.replace(/\/+$/, '')}/wp-json/wc/v3`;

    this.httpClient = axios.create({
      baseURL,
      timeout: 15000,
      headers: {
        'User-Agent': 'Razorpay-Agent-Studio-WooCommerce-Connector/1.0.0',
        Accept: 'application/json',
      },
    });
  }

  /**
   * Generates OAuth 1.0a HMAC-SHA256 signature and query parameters for non-SSL or legacy endpoints
   */
  public generateOAuth1Params(
    method: 'GET' | 'POST',
    url: string,
    params: Record<string, any> = {}
  ): Record<string, string> {
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.config.consumerKey || '',
      oauth_nonce: crypto.randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA256',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_version: '1.0',
      ...params,
    };

    // Sort parameters lexicographically
    const sortedKeys = Object.keys(oauthParams).sort();
    const paramString = sortedKeys
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(oauthParams[key])}`)
      .join('&');

    const baseString = [method.toUpperCase(), encodeURIComponent(url), encodeURIComponent(paramString)].join('&');

    const signingKey = `${encodeURIComponent(this.config.consumerSecret || '')}&`;
    const signature = crypto.createHmac('sha256', signingKey).update(baseString).digest('base64');

    oauthParams['oauth_signature'] = signature;
    return oauthParams;
  }

  /**
   * Prepare authentication headers/params for live requests
   */
  private getAuthHeaders(): Record<string, string> {
    if (this.config.authMethod === 'basic_auth' || !this.config.authMethod) {
      const token = Buffer.from(
        `${this.config.consumerKey}:${this.config.consumerSecret}`
      ).toString('base64');
      return {
        Authorization: `Basic ${token}`,
      };
    }
    return {};
  }

  /**
   * Primitive 1: List orders with pagination, status filter, and date constraints
   */
  public async listOrders(params: ListOrdersParams = { page: 1, per_page: 10, order: 'desc', orderby: 'date' }): Promise<ListOrdersResult> {
    if (this.config.mode === 'live' && this.httpClient) {
      return this.rateLimiter.executeWithRetry(async () => {
        const response = await this.httpClient!.get<WooCommerceOrder[]>('/orders', {
          params,
          headers: this.getAuthHeaders(),
        });

        const total = parseInt(response.headers['x-wp-total'] || `${response.data.length}`, 10);
        const totalPages = parseInt(response.headers['x-wp-totalpages'] || '1', 10);

        return {
          orders: response.data,
          total,
          totalPages,
          page: params.page ?? 1,
          per_page: params.per_page ?? 10,
        };
      }, 'listOrders');
    }

    // Mock Mode Execution
    return this.rateLimiter.executeWithRetry(async () => {
      let filtered = [...this.mockDataset];

      if (params.status && params.status !== 'any') {
        filtered = filtered.filter((order) => order.status === params.status);
      }

      if (params.customer) {
        filtered = filtered.filter((order) => order.customer_id === params.customer);
      }

      if (params.after) {
        const afterDate = new Date(params.after).getTime();
        filtered = filtered.filter((order) => new Date(order.date_created).getTime() >= afterDate);
      }

      if (params.before) {
        const beforeDate = new Date(params.before).getTime();
        filtered = filtered.filter((order) => new Date(order.date_created).getTime() <= beforeDate);
      }

      // Sorting
      filtered.sort((a, b) => {
        const dateA = new Date(a.date_created).getTime();
        const dateB = new Date(b.date_created).getTime();
        return params.order === 'asc' ? dateA - dateB : dateB - dateA;
      });

      const total = filtered.length;
      const page = params.page ?? 1;
      const perPage = params.per_page ?? 10;
      const totalPages = Math.max(1, Math.ceil(total / perPage));

      const startIndex = (page - 1) * perPage;
      const paginatedOrders = filtered.slice(startIndex, startIndex + perPage);

      return {
        orders: paginatedOrders,
        total,
        totalPages,
        page,
        per_page: perPage,
      };
    }, 'mock_listOrders');
  }

  /**
   * Primitive 2: Get single order by ID
   */
  public async getOrder(params: GetOrderParams): Promise<WooCommerceOrder> {
    if (this.config.mode === 'live' && this.httpClient) {
      return this.rateLimiter.executeWithRetry(async () => {
        const response = await this.httpClient!.get<WooCommerceOrder>(`/orders/${params.order_id}`, {
          headers: this.getAuthHeaders(),
        });
        return response.data;
      }, `getOrder_${params.order_id}`);
    }

    // Mock Mode Execution
    return this.rateLimiter.executeWithRetry(async () => {
      const order = this.mockDataset.find((o) => o.id === params.order_id);
      if (!order) {
        const err: any = new Error(`Order with ID #${params.order_id} not found.`);
        err.status = 404;
        throw err;
      }
      return order;
    }, `mock_getOrder_${params.order_id}`);
  }

  /**
   * Primitive 3: Multi-field Search across orders
   * Searches by customer name, customer email, order ID, line items, and transaction/payment ID
   */
  public async searchOrders(params: SearchOrdersParams): Promise<WooCommerceOrder[]> {
    const q = params.query.trim().toLowerCase();
    const limit = params.limit ?? 10;

    if (this.config.mode === 'live' && this.httpClient) {
      return this.rateLimiter.executeWithRetry(async () => {
        // WooCommerce native search queries order fields
        const response = await this.httpClient!.get<WooCommerceOrder[]>('/orders', {
          params: { search: params.query, per_page: limit },
          headers: this.getAuthHeaders(),
        });
        return response.data;
      }, `searchOrders_${params.query}`);
    }

    // Mock Mode Multi-field search
    return this.rateLimiter.executeWithRetry(async () => {
      const matches = this.mockDataset.filter((order) => {
        // 1. Check order ID
        if (order.id.toString() === q || order.number === q) return true;

        // 2. Check billing / shipping email
        if (order.billing?.email?.toLowerCase().includes(q)) return true;

        // 3. Check customer name
        const customerName = `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.toLowerCase();
        if (customerName.includes(q)) return true;

        // 4. Check payment transaction ID / Razorpay Payment ID
        if (order.transaction_id && order.transaction_id.toLowerCase().includes(q)) return true;

        const razorpayMeta = order.meta_data?.some(
          (m) =>
            (m.key === '_razorpay_payment_id' || m.key === '_razorpay_order_id') &&
            typeof m.value === 'string' &&
            m.value.toLowerCase().includes(q)
        );
        if (razorpayMeta) return true;

        // 5. Check product names or SKUs in line items
        const itemMatch = order.line_items?.some(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            (item.sku && item.sku.toLowerCase().includes(q))
        );
        if (itemMatch) return true;

        return false;
      });

      return matches.slice(0, limit);
    }, `mock_searchOrders_${params.query}`);
  }

  /**
   * Primitive 4: Payment Reconciliation (Special Agent Studio Primitive)
   * Cross-verifies a Razorpay payment ID and transaction amount against WooCommerce order records.
   */
  public async reconcilePayment(params: ReconcilePaymentParams): Promise<ReconciliationResult> {
    const order = await this.getOrder({ order_id: params.order_id });
    const notes: string[] = [];
    const discrepancies: string[] = [];

    // Check payment method & transaction ID
    const matchesTxId =
      order.transaction_id === params.razorpay_payment_id ||
      order.meta_data?.some(
        (m) => m.key === '_razorpay_payment_id' && m.value === params.razorpay_payment_id
      );

    if (!matchesTxId) {
      discrepancies.push(
        `Transaction ID mismatch: Order has '${order.transaction_id || 'none'}' but received '${params.razorpay_payment_id}'`
      );
    } else {
      notes.push(`Verified Razorpay Payment ID '${params.razorpay_payment_id}' matches order.`);
    }

    // Amount match check
    let amountMatch = true;
    if (params.expected_amount !== undefined) {
      const orderAmountNum = parseFloat(order.total);
      if (Math.abs(orderAmountNum - params.expected_amount) > 0.01) {
        amountMatch = false;
        discrepancies.push(
          `Amount discrepancy: Store order total is ${order.currency} ${order.total}, expected ${order.currency} ${params.expected_amount}`
        );
      } else {
        notes.push(`Order amount matches expected amount (${order.currency} ${order.total}).`);
      }
    }

    // Order status sanity check
    if (order.status === 'failed') {
      discrepancies.push(`Order status is marked as 'failed' in WooCommerce.`);
    } else if (order.status === 'refunded') {
      notes.push(`Order was previously refunded.`);
    } else if (order.status === 'completed' || order.status === 'processing') {
      notes.push(`Order is in active good standing (${order.status}).`);
    }

    const matched = discrepancies.length === 0;

    return {
      matched,
      orderId: order.id,
      paymentId: params.razorpay_payment_id,
      status: order.status,
      currency: order.currency,
      orderTotal: order.total,
      amountMatch,
      notes,
      discrepancies,
    };
  }

  /**
   * Helper to simulate a rate-limit event for demonstration and testing purposes
   */
  public simulateThrottledRequest(retryAfterSeconds: number = 1): Promise<string> {
    let callCount = 0;
    return this.rateLimiter.executeWithRetry(async () => {
      callCount += 1;
      if (callCount === 1) {
        const err: any = new Error('HTTP 429: Too Many Requests (Simulated WooCommerce Throttling)');
        err.response = {
          status: 429,
          headers: { 'retry-after': retryAfterSeconds.toString() },
        };
        throw err;
      }
      return 'Successfully recovered and executed after rate-limit backoff!';
    }, 'simulateThrottledRequest');
  }
}

# Agent Capabilities & Security Specification

**System:** WooCommerce Private Connector  
**Interface:** Model Context Protocol (MCP)  
**Target:** WooCommerce REST API v3  

---

## 1. Overview & Principle of Least Privilege

When integrating autonomous agents into merchant production environments, enforcing deterministic security boundaries is essential. Granting an agent unrestricted write or mutation permissions introduces severe operational and financial risks (such as unauthorized discounts, incorrect inventory updates, or balance drainage via unapproved refunds).

This connector enforces a **strict read-and-reconcile boundary**. It equips the agent with sufficient context to diagnose merchant issues, audit line items, and cross-reference payments, while excluding high-risk write operations.

---

## 2. Permitted Capabilities (What the Agent CAN Do)

| Capability | Tool | Functional Scope |
| :--- | :--- | :--- |
| **Pipeline Inspection** | `list_orders` | Query store orders with pagination, status filtering (`pending`, `processing`, `completed`, `refunded`, `failed`), and date constraints. |
| **Order Audit** | `get_order` | Retrieve granular details for a specific order: customer contact, shipping/billing address, itemized line items (SKU, quantity, unit price), tax breakdowns, and customer notes. |
| **Multi-Entity Search** | `search_orders` | Search across multiple fields: customer name, email address, order number, line item products, or payment transaction IDs. |
| **Payment Reconciliation** | `reconcile_payment` | Cross-verify a Razorpay payment ID (`pay_...`) and expected amount against store records, flagging status or total mismatches. |
| **Operational Telemetry** | `get_connector_metrics` | Check connector operational health: token bucket capacity, total requests, throttled requests, and retry success rates. |

### Operational Resilience
- **Automated Throttling Handling**: Respects upstream `HTTP 429 Too Many Requests` responses, parses `Retry-After` headers, and performs exponential backoff with full randomized jitter.
- **Dual Execution Engine**: Operates against live WooCommerce REST API v3 stores or an isolated in-memory sandbox for offline development.

---

## 3. Security Boundaries (What the Agent CANNOT Do)

The following actions are strictly disallowed at the connector interface level:

### 1. Order or Financial Record Mutation
- **Disallowed**: Modifying order amounts, applying manual discounts, adjusting line item quantities, or altering tax calculations.
- **Rationale**: An agent experiencing prompt injection, context confusion, or hallucination must never have the authority to modify financial ledger entries.

### 2. Automated Refund Initiation
- **Disallowed**: Initiating payment refunds or payouts via the connector.
- **Rationale**: Automated refunds present an immense balance drainage vector. Refund initiation must always require merchant Human-in-the-Loop (HITL) approval with multi-factor authentication.

### 3. Record Deletion or Trashing
- **Disallowed**: `DELETE /orders/{id}` or state transition to `trash`.
- **Rationale**: Protects merchant transaction history and legal audit logs from accidental or adversarial deletion.

### 4. Direct Access to Payment Card Data (PCI-DSS)
- **Disallowed**: Access to raw credit/debit card numbers, CVVs, or bank credentials.
- **Rationale**: WooCommerce and Razorpay tokenize all payment methods. The connector only receives masked identifiers and opaque Razorpay transaction IDs (`pay_...`), maintaining strict PCI-DSS Scope-1 exemption.

### 5. Unbounded Bulk Scraping
- **Disallowed**: Unindexed bulk dumps. Pagination is capped at `per_page: 100`, protected by a token bucket rate limiter (default: 60 req/min).
- **Rationale**: Prevents accidental denial-of-service (DoS) or performance degradation on shared merchant hosting.

---

## 4. Input Validation & Hallucination Mitigation

1. **Zod Runtime Schema Validation**:
   All incoming tool invocations are strictly parsed against typed Zod schemas. Non-conforming or hallucinated parameters are rejected before network execution.
2. **Deterministic Output Structure**:
   All tool responses return structured JSON with consistent field types, ensuring clean downstream context for the agent planner.
3. **Encapsulated Error Handling**:
   Upstream errors (404 not found, 401 unauthorized, 429 throttled) return explicit status codes and actionable descriptions rather than crashing the execution process.

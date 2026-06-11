import crypto from "node:crypto";

import { getAppUrl, readInt } from "../config.js";

const PAYSTACK_BASE = "https://api.paystack.co";

function createPaystackService({ fetchImpl = fetch } = {}) {
  const timeoutMs = readInt("PAYSTACK_REQUEST_TIMEOUT_MS", 15000, { min: 1000, max: 60000 });
  function headers() {
    if (!process.env.PAYSTACK_SECRET_KEY) throw new Error("PAYSTACK_SECRET_KEY is not configured.");
    return {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json"
    };
  }

  async function initialize(order) {
    const response = await fetchImpl(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: "POST",
      headers: headers(),
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        email: order.customer_email,
        amount: String(order.amount_usd_cents),
        currency: "USD",
        reference: order.paystack_reference,
        channels: ["card"],
        callback_url: `${getAppUrl()}/payments/paystack/callback`,
        metadata: {
          order_code: order.order_code,
          public_token: order.public_token,
          customer_name: order.customer_name,
          ticket_type: order.ticket_type,
          quantity: order.quantity
        }
      })
    });
    const payload = await response.json();
    if (!response.ok || !payload.status || !payload.data?.authorization_url) {
      throw new Error(payload.message || `Paystack initialization returned ${response.status}.`);
    }
    return payload.data;
  }

  async function verify(reference) {
    const response = await fetchImpl(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: headers(),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const payload = await response.json();
    if (!response.ok || !payload.status || !payload.data) {
      throw new Error(payload.message || `Paystack verification returned ${response.status}.`);
    }
    return payload.data;
  }

  function assertVerifiedPayment(order, transaction) {
    if (transaction.reference !== order.paystack_reference) throw new Error("Paystack reference mismatch.");
    if (transaction.status !== "success") throw new Error("Payment has not succeeded.");
    if (transaction.currency !== "USD") throw new Error("Payment currency mismatch.");
    if (Number(transaction.amount) !== Number(order.amount_usd_cents)) throw new Error("Payment amount mismatch.");
    return true;
  }

  function verifyWebhookSignature(rawBody, signature) {
    if (!process.env.PAYSTACK_SECRET_KEY || !rawBody || !signature) return false;
    const expected = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");
    const received = Buffer.from(String(signature));
    const expectedBuffer = Buffer.from(expected);
    return received.length === expectedBuffer.length && crypto.timingSafeEqual(received, expectedBuffer);
  }

  return { assertVerifiedPayment, initialize, verify, verifyWebhookSignature };
}

export { createPaystackService };

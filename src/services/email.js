import { getAppUrl, readInt } from "../config.js";
import { buildTicketZip } from "./tickets.js";

const BREVO_EMAIL_URL = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_SENDER_NAME = "LuminTix Tickets (No Reply)";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function createEmailService({ commerceStore, fetchImpl = fetch, buildZip = buildTicketZip } = {}) {
  const timeoutMs = readInt("BREVO_REQUEST_TIMEOUT_MS", 15000, { min: 1000, max: 60000 });
  const enabled = Boolean(process.env.BREVO_API_KEY && process.env.BREVO_SENDER_EMAIL);

  async function sendOrderTickets(orderWithTickets, delivery) {
    if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) {
      throw new Error("BREVO_API_KEY and BREVO_SENDER_EMAIL are required to send tickets.");
    }

    const senderName = process.env.BREVO_SENDER_NAME || DEFAULT_SENDER_NAME;
    const zip = await buildZip(orderWithTickets);
    const downloadUrl = `${getAppUrl()}/orders/${orderWithTickets.public_token}/success`;
    const ticketCount = `${orderWithTickets.quantity} ticket${orderWithTickets.quantity === 1 ? "" : "s"}`;
    const eventTitle = orderWithTickets.event_snapshot.title;
    const response = await fetchImpl(BREVO_EMAIL_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": process.env.BREVO_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: {
          name: senderName,
          email: process.env.BREVO_SENDER_EMAIL
        },
        to: [
          {
            name: orderWithTickets.customer_name,
            email: orderWithTickets.customer_email
          }
        ],
        subject: `Your LuminTix tickets for ${eventTitle}`,
        htmlContent: `
        <h1>Your tickets are ready</h1>
        <p>${ticketCount} for <strong>${escapeHtml(eventTitle)}</strong> are attached.</p>
        <p>You can also download them from <a href="${escapeHtml(downloadUrl)}">${escapeHtml(downloadUrl)}</a>.</p>
        <p>This is an automated ticket-delivery email from an unmonitored mailbox. Replies are not read.</p>
      `,
        textContent: `Your ${ticketCount} for ${eventTitle} are attached. You can also download them from ${downloadUrl}. This is an automated ticket-delivery email from an unmonitored mailbox. Replies are not read.`,
        attachment: [
          {
            name: `lumintix-${orderWithTickets.order_code}-tickets.zip`,
            content: zip.toString("base64")
          }
        ],
        tags: ["ticket-delivery"]
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    const result = await readResponseBody(response);
    if (response.status !== 201 || !result.messageId) {
      const detail = result.message || result.code || "Unexpected response.";
      throw new Error(`Brevo ticket delivery failed (${response.status}): ${detail}`);
    }

    await commerceStore.updateEmailDelivery(delivery.id, { status: "sent", provider_id: result.messageId });
  }

  async function processPending() {
    if (!enabled) return;
    const deliveries = await commerceStore.getPendingEmailDeliveries();
    for (const delivery of deliveries) {
      try {
        const order = await commerceStore.getOrderWithTickets(delivery.order_id);
        if (!order || order.status !== "paid") continue;
        await sendOrderTickets(order, delivery);
      } catch (error) {
        await commerceStore.updateEmailDelivery(delivery.id, { status: "failed", last_error: error.message });
      }
    }
  }

  return { enabled, processPending, sendOrderTickets };
}

export { BREVO_EMAIL_URL, createEmailService };

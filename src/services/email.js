import { Resend } from "resend";

import { buildTicketZip } from "./tickets.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createEmailService({ commerceStore }) {
  const enabled = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

  async function sendOrderTickets(orderWithTickets, delivery) {
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
      throw new Error("RESEND_API_KEY and EMAIL_FROM are required to send tickets.");
    }
    const resend = new Resend(process.env.RESEND_API_KEY);
    const zip = await buildTicketZip(orderWithTickets);
    const downloadUrl = `${process.env.APP_URL}/orders/${orderWithTickets.public_token}/success`;
    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: orderWithTickets.customer_email,
      subject: `Your LuminTix tickets for ${orderWithTickets.event_snapshot.title}`,
      html: `
        <h1>Your tickets are ready</h1>
        <p>${orderWithTickets.quantity} ticket${orderWithTickets.quantity === 1 ? "" : "s"} for
        <strong>${escapeHtml(orderWithTickets.event_snapshot.title)}</strong> are attached.</p>
        <p>You can also download them from <a href="${escapeHtml(downloadUrl)}">${escapeHtml(downloadUrl)}</a>.</p>
      `,
      attachments: [
        {
          filename: `lumintix-${orderWithTickets.order_code}-tickets.zip`,
          content: zip.toString("base64")
        }
      ]
    });
    if (result.error) throw new Error(result.error.message);
    await commerceStore.updateEmailDelivery(delivery.id, { status: "sent", provider_id: result.data?.id });
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

export { createEmailService };

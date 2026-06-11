import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import QRCode from "qrcode";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logoPath = path.join(__dirname, "..", "..", "public", "images", "lumintix-logo-lockup.png");

function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatTicketDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(new Date(value));
}

function wrap(value, max = 32) {
  const words = String(value || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 2);
}

function textLines(lines, x, y, size = 34) {
  return lines
    .map((line, index) => `<text x="${x}" y="${y + index * (size + 8)}" class="value" font-size="${size}">${escapeXml(line)}</text>`)
    .join("");
}

async function renderTicketPng(order, ticket) {
  const event = order.event_snapshot;
  const validationUrl = `${process.env.APP_URL}/tickets/check-in/${ticket.validation_token}`;
  const qr = await QRCode.toDataURL(validationUrl, { width: 360, margin: 1, errorCorrectionLevel: "H" });
  const logo = `data:image/png;base64,${(await fs.readFile(logoPath)).toString("base64")}`;
  const location = [event.venue_name, event.city].filter(Boolean).join(", ") || "Location to be announced";
  const titleLines = wrap(event.title, 30);
  const locationLines = wrap(location, 32);

  const svg = `
  <svg width="1536" height="1024" viewBox="0 0 1536 1024" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#5668f4"/>
        <stop offset=".32" stop-color="#e8b8ff"/>
        <stop offset=".72" stop-color="#fff9ff"/>
        <stop offset="1" stop-color="#dce4ff"/>
      </linearGradient>
      <linearGradient id="glow" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#a020f0" stop-opacity=".45"/>
        <stop offset="1" stop-color="#fff" stop-opacity=".08"/>
      </linearGradient>
      <filter id="soft"><feGaussianBlur stdDeviation="34"/></filter>
      <style>
        .label{font-family:Arial,sans-serif;font-weight:700;fill:#080858;font-size:24px}
        .value{font-family:Arial,sans-serif;font-weight:700;fill:#09094e}
        .line{stroke:#6d3be8;stroke-width:2;opacity:.55}
      </style>
    </defs>
    <rect width="1536" height="1024" fill="#161224"/>
    <rect x="44" y="124" width="1448" height="756" rx="44" fill="url(#bg)" stroke="#6332d7" stroke-width="3"/>
    <circle cx="1074" cy="124" r="30" fill="#161224"/><circle cx="1074" cy="880" r="30" fill="#161224"/>
    <ellipse cx="760" cy="310" rx="430" ry="220" fill="#fbd6ff" opacity=".65" filter="url(#soft)"/>
    <ellipse cx="420" cy="770" rx="420" ry="160" fill="#5249f5" opacity=".36" filter="url(#soft)"/>
    <rect x="44" y="124" width="1030" height="756" rx="44" fill="url(#glow)" opacity=".35"/>
    <path d="M1074 154V850" stroke="#7140cb" stroke-width="8" stroke-linecap="round" stroke-dasharray="2 18"/>
    <image href="${logo}" x="105" y="160" width="520" height="118" preserveAspectRatio="xMinYMid meet"/>
    <g opacity=".14" transform="translate(600 260) scale(2.7)"><path fill="#5a20cf" d="M20 10h36L36 92H0zM70 38h56l-10 32H60zM133 38h49l-42 92h-37z"/></g>
    <g transform="translate(106 335)">
      <text class="label" x="120" y="0">TICKET TYPE</text>
      <text class="value" x="120" y="46" font-size="38">${escapeXml(order.ticket_type)}</text>
      <circle cx="46" cy="23" r="34" fill="#6927ce"/><path d="M28 24h36M46 6v36" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
      <path class="line" d="M0 82H575"/>
      <text class="label" x="120" y="135">EVENT NAME</text>
      ${textLines(titleLines, 120, 182, 34)}
      <rect x="10" y="129" width="72" height="64" rx="8" fill="#5721be"/><circle cx="46" cy="161" r="15" fill="#f6dbff"/>
      <path class="line" d="M0 245H575"/>
      <text class="label" x="120" y="296">LOCATION</text>
      ${textLines(locationLines, 120, 343, 31)}
      <path d="M46 280c-28 0-50 22-50 50 0 40 50 88 50 88s50-48 50-88c0-28-22-50-50-50zm0 68a20 20 0 1 1 0-40 20 20 0 0 1 0 40z" fill="#6325ce"/>
      <path class="line" d="M0 425H575"/>
      <text class="label" x="120" y="475">DATE / TIME</text>
      <text class="value" x="120" y="524" font-size="29">${escapeXml(formatTicketDate(event.starts_at))}</text>
      <rect x="8" y="453" width="76" height="76" rx="12" fill="#6427cd"/><path d="M22 478h48M26 465v22M66 465v22M26 494h38v24H26z" stroke="#fff" stroke-width="6" fill="none"/>
    </g>
    <g transform="translate(1115 245)">
      <text class="label" x="5" y="45" font-size="25">SCAN TO VALIDATE</text>
      <rect x="0" y="82" width="330" height="330" rx="24" fill="#fff" stroke="#5a25f0" stroke-width="4"/>
      <image href="${qr}" x="16" y="98" width="298" height="298"/>
      <path class="line" d="M0 450H330"/>
      <text class="label" x="105" y="505">TICKET ID</text>
      <text class="value" x="32" y="558" font-size="27">${escapeXml(ticket.ticket_code)}</text>
    </g>
    <g opacity=".12" fill="#301675">
      <circle cx="470" cy="823" r="42"/><circle cx="545" cy="810" r="55"/><circle cx="630" cy="828" r="43"/>
      <circle cx="710" cy="805" r="60"/><circle cx="805" cy="825" r="48"/><circle cx="890" cy="802" r="58"/>
      <path d="M530 825l30-120 28 120M760 825l-22-145-25 145M900 825l42-125 12 125"/>
    </g>
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function renderTicketPdf(order, ticket) {
  const png = await renderTicketPng(order, ticket);
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([1152, 768]);
  const image = await pdf.embedPng(png);
  page.drawImage(image, { x: 0, y: 0, width: 1152, height: 768 });
  return Buffer.from(await pdf.save());
}

async function buildTicketZip(orderWithTickets) {
  const zip = new JSZip();
  for (const ticket of orderWithTickets.tickets) {
    zip.file(`${ticket.ticket_code}.pdf`, await renderTicketPdf(orderWithTickets, ticket));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export { buildTicketZip, renderTicketPdf, renderTicketPng };

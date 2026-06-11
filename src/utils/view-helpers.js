function formatDate(value, options = {}) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options
  }).format(new Date(value));
}

function formatMonth(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(value));
}

function formatDay(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en", { day: "2-digit" }).format(new Date(value));
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return "";
  return `${formatDate(value)} at ${formatTime(value)}`;
}

function formatUsd(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Number(cents || 0) / 100
  );
}

function dateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

function shortText(value, length = 140) {
  if (!value) return "";
  if (value.length <= length) return value;
  return `${value.slice(0, length).trim()}...`;
}

function statusLabel(value) {
  const labels = {
    draft: "Draft",
    published: "Published",
    sold_out: "Sold Out",
    postponed: "Postponed",
    cancelled: "Cancelled",
    available: "Available",
    limited: "Limited",
    new: "New",
    contacted: "Contacted",
    confirmed: "Confirmed",
    closed: "Closed",
    pending: "Pending",
    processing: "Processing",
    paid: "Paid",
    failed: "Failed",
    valid: "Valid",
    used: "Used"
  };

  return labels[value] || value;
}

function activeClass(currentPath, targetPath) {
  if (targetPath === "/" && currentPath === "/") return "active";
  if (targetPath !== "/" && currentPath.startsWith(targetPath)) return "active";
  return "";
}

export default {
  formatDate,
  formatMonth,
  formatDay,
  formatTime,
  formatDateTime,
  formatUsd,
  dateInputValue,
  shortText,
  statusLabel,
  activeClass
};

import crypto from "node:crypto";

export interface TrackingClassification {
  actorClass: "human_likely" | "automated_likely" | "unknown";
  confidence: "low" | "medium" | "high";
  reason: string;
}

const AUTOMATION_MARKERS = [
  "proofpoint",
  "barracuda",
  "mimecast",
  "urlscan",
  "safelinks",
  "microsoft office existence discovery",
  "googleimageproxy",
  "curl/",
  "wget/",
  "python-requests",
  "headlesschrome",
  "security scanner",
];

export function classifyTrackingRequest(
  eventType: "email_opened" | "link_clicked" | "attachment_opened" | "training_viewed" | "training_acknowledged",
  headers: Record<string, string | string[] | undefined>,
): TrackingClassification {
  const userAgent = String(headers["user-agent"] ?? "").toLowerCase();
  const purpose = `${String(headers.purpose ?? "")} ${String(headers["sec-purpose"] ?? "")}`.toLowerCase();
  if (AUTOMATION_MARKERS.some((marker) => userAgent.includes(marker)) || /prefetch|preview/.test(purpose)) {
    return { actorClass: "automated_likely", confidence: "high", reason: "known_scanner_or_prefetch" };
  }
  if (eventType === "email_opened") {
    return { actorClass: "unknown", confidence: "low", reason: "mail_image_load_is_ambiguous" };
  }
  if (!userAgent) return { actorClass: "unknown", confidence: "low", reason: "missing_user_agent" };
  if (eventType === "link_clicked") {
    return { actorClass: "human_likely", confidence: "medium", reason: "interactive_link_request" };
  }
  return { actorClass: "human_likely", confidence: "high", reason: "controlled_interactive_action" };
}

export function clientFingerprintHash(
  salt: Buffer,
  ip: string | undefined,
  userAgent: string | undefined,
): string | null {
  if (!ip && !userAgent) return null;
  return crypto
    .createHmac("sha256", salt)
    .update(`${ip ?? ""}\u0000${userAgent ?? ""}`)
    .digest("hex");
}

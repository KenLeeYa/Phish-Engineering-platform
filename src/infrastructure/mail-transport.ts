import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";
import type { QueuedDelivery, StoredConnector } from "./campaign-store.js";
import { SecretVault } from "./secret-vault.js";

export interface DeliveryMessage {
  to: { name: string; address: string };
  subject: string;
  html: string;
  text: string;
  attachments: Array<{ fileName: string; mimeType: string; content: Buffer }>;
}

export interface MailSendResult {
  messageId: string;
}

function safeHeader(value: string): string {
  return value.replace(/[\r\n\u0000]/g, " ").replace(/\s+/g, " ").trim();
}

function smtpOptions(connector: StoredConnector, vault: SecretVault): Record<string, unknown> {
  const host = String(connector.config.host ?? "");
  const port = Number(connector.config.port);
  const secure = connector.config.secure === true;
  const username = String(connector.config.username ?? "");
  const password = connector.secretRef ? vault.get(connector.secretRef) : "";
  return {
    host,
    port,
    secure,
    requireTLS: !secure,
    auth: username ? { user: username, pass: password } : undefined,
    tls: { rejectUnauthorized: true, servername: host },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

export class MailTransport {
  constructor(
    private readonly pickupDirectory: string,
    private readonly vault: SecretVault,
  ) {}

  async verify(connector: StoredConnector): Promise<void> {
    if (connector.connectorType === "pickup") {
      await fs.mkdir(this.pickupDirectory, { recursive: true });
      await fs.access(this.pickupDirectory);
      return;
    }
    const transport = nodemailer.createTransport(smtpOptions(connector, this.vault));
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
  }

  async send(connector: StoredConnector, message: DeliveryMessage): Promise<MailSendResult> {
    const from = {
      name: safeHeader(connector.senderName),
      address: safeHeader(connector.senderEmail),
    };
    const common = {
      from,
      to: { name: safeHeader(message.to.name), address: safeHeader(message.to.address) },
      subject: safeHeader(message.subject),
      html: message.html,
      text: message.text,
      attachments: message.attachments.map((attachment) => ({
        filename: path.basename(attachment.fileName),
        contentType: attachment.mimeType,
        content: attachment.content,
      })),
      disableFileAccess: true,
      disableUrlAccess: true,
      headers: {
        "X-Security-Awareness-Simulation": "authorized-internal",
      },
    };

    if (connector.connectorType === "pickup") {
      const transport = nodemailer.createTransport({
        streamTransport: true,
        buffer: true,
        newline: "windows",
      });
      const result = await transport.sendMail(common);
      const messageId = safeHeader(result.messageId || `<${crypto.randomUUID()}@local-awareness>`);
      const safeId = messageId.replace(/[^a-z0-9._-]/gi, "_").slice(0, 120);
      await fs.mkdir(this.pickupDirectory, { recursive: true });
      await fs.writeFile(
        path.join(this.pickupDirectory, `${Date.now()}-${safeId || crypto.randomUUID()}.eml`),
        Buffer.isBuffer(result.message) ? result.message : Buffer.from(String(result.message)),
        { flag: "wx", mode: 0o600 },
      );
      return { messageId };
    }

    const transport = nodemailer.createTransport(smtpOptions(connector, this.vault));
    try {
      const result = await transport.sendMail(common);
      return { messageId: safeHeader(result.messageId || crypto.randomUUID()) };
    } finally {
      transport.close();
    }
  }

  messageForDelivery(delivery: QueuedDelivery): DeliveryMessage {
    const clickUrl = `${delivery.baseUrl}/t/c/${encodeURIComponent(delivery.trackingToken)}`;
    const pixelUrl = `${delivery.baseUrl}/t/o/${encodeURIComponent(delivery.trackingToken)}.gif`;
    const controlledAttachments = delivery.attachments.length
      ? `<div style="margin-top:20px;padding:12px;background:#f3f6f4"><strong>受控附件</strong><ul>${delivery.attachments
          .map(
            (attachment) =>
              `<li><a href="${delivery.baseUrl}/t/a/${encodeURIComponent(delivery.trackingToken)}/${encodeURIComponent(attachment.id)}">${attachment.fileName.replace(/[&<>"']/g, "")}</a></li>`,
          )
          .join("")}</ul></div>`
      : "";
    const html = delivery.htmlBody
      .replaceAll("{{training_url}}", clickUrl)
      .replaceAll("{{recipient_name}}", delivery.recipientName.replace(/[&<>"']/g, ""))
      .replaceAll("{{recipient_email}}", delivery.recipientEmail.replace(/[&<>"']/g, ""));
    const text = delivery.textBody
      .replaceAll("{{training_url}}", clickUrl)
      .replaceAll("{{recipient_name}}", delivery.recipientName)
      .replaceAll("{{recipient_email}}", delivery.recipientEmail);
    return {
      to: { name: delivery.recipientName, address: delivery.recipientEmail },
      subject: delivery.subject,
      html: `${html}${controlledAttachments}<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none">`,
      text: `${text}${delivery.attachments.length ? `\n\n受控附件：\n${delivery.attachments.map((item) => `${item.fileName}: ${delivery.baseUrl}/t/a/${delivery.trackingToken}/${item.id}`).join("\n")}` : ""}`,
      attachments: delivery.attachments.map((attachment) => ({
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        content: attachment.content,
      })),
    };
  }
}

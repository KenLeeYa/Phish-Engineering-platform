export interface PlatformSettings {
  schemaVersion: 1;
  organization: {
    name: string;
    timezone: string;
    retentionDays: number;
  };
  scope: {
    recipientDomains: string[];
    senderDomains: string[];
    testRecipientEmails: string[];
  };
  delivery: {
    enabled: false;
    connectorType: "not_configured";
  };
}

export type ReadinessStatus = "ready" | "action_required" | "planned";

export interface ReadinessItem {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
  phase: number;
}

export interface PlatformReadiness {
  currentPhase: 5;
  mailSendingEnabled: boolean;
  readyCount: number;
  items: ReadinessItem[];
}

export class SettingsValidationError extends Error {}

const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function recordFrom(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SettingsValidationError("設定內容格式不正確。");
  }
  return value as Record<string, unknown>;
}

function textField(value: unknown, label: string, minimum: number, maximum: number): string {
  if (typeof value !== "string") throw new SettingsValidationError(`${label}格式不正確。`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new SettingsValidationError(`${label}長度必須介於 ${minimum} 到 ${maximum} 個字元。`);
  }
  return normalized;
}

function listFrom(value: unknown, label: string, maximum: number): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]/)
      : null;
  if (!values) throw new SettingsValidationError(`${label}格式不正確。`);
  if (values.some((item) => typeof item !== "string")) {
    throw new SettingsValidationError(`${label}每一筆都必須是文字。`);
  }
  const normalized = (values as string[])
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(normalized)];
  if (unique.length > maximum) throw new SettingsValidationError(`${label}最多 ${maximum} 筆。`);
  return unique;
}

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("zh-TW", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function createInitialSettings(organizationName: string): PlatformSettings {
  return {
    schemaVersion: 1,
    organization: {
      name: organizationName,
      timezone: "Asia/Taipei",
      retentionDays: 365,
    },
    scope: {
      recipientDomains: [],
      senderDomains: [],
      testRecipientEmails: [],
    },
    delivery: {
      enabled: false,
      connectorType: "not_configured",
    },
  };
}

export function applySettingsUpdate(
  current: PlatformSettings,
  input: unknown,
): PlatformSettings {
  const record = recordFrom(input);
  const organizationName = textField(
    record.organizationName ?? current.organization.name,
    "組織名稱",
    2,
    120,
  );
  const timezone = textField(
    record.timezone ?? current.organization.timezone,
    "時區",
    3,
    80,
  );
  if (!validTimezone(timezone)) throw new SettingsValidationError("時區不是有效的 IANA 時區。");

  const retentionDays = Number(record.retentionDays ?? current.organization.retentionDays);
  if (!Number.isInteger(retentionDays) || retentionDays < 30 || retentionDays > 3_650) {
    throw new SettingsValidationError("保存期限必須是 30 到 3650 天的整數。");
  }

  const recipientDomains = listFrom(
    record.recipientDomains ?? current.scope.recipientDomains,
    "內部收件網域",
    50,
  );
  const senderDomains = listFrom(
    record.senderDomains ?? current.scope.senderDomains,
    "核准寄件網域",
    20,
  );
  const testRecipientEmails = listFrom(
    record.testRecipientEmails ?? current.scope.testRecipientEmails,
    "測試信箱",
    50,
  );

  for (const domain of [...recipientDomains, ...senderDomains]) {
    if (!DOMAIN_PATTERN.test(domain)) {
      throw new SettingsValidationError(`網域格式不正確：${domain}`);
    }
  }
  for (const email of testRecipientEmails) {
    if (!EMAIL_PATTERN.test(email)) throw new SettingsValidationError(`Email 格式不正確：${email}`);
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (!recipientDomains.includes(domain)) {
      throw new SettingsValidationError(`測試信箱必須屬於內部收件網域：${email}`);
    }
  }

  return {
    schemaVersion: 1,
    organization: { name: organizationName, timezone, retentionDays },
    scope: { recipientDomains, senderDomains, testRecipientEmails },
    delivery: { enabled: false, connectorType: "not_configured" },
  };
}

export function buildReadiness(
  settings: PlatformSettings,
  mailSendingEnabled = false,
): PlatformReadiness {
  const items: ReadinessItem[] = [
    {
      id: "admin_account",
      label: "本機管理員",
      status: "ready",
      detail: "首位系統管理員已建立。",
      phase: 1,
    },
    {
      id: "organization",
      label: "組織與保存期限",
      status: settings.organization.name ? "ready" : "action_required",
      detail: `${settings.organization.timezone}，保存 ${settings.organization.retentionDays} 天。`,
      phase: 1,
    },
    {
      id: "recipient_scope",
      label: "內部收件網域",
      status: settings.scope.recipientDomains.length ? "ready" : "action_required",
      detail: settings.scope.recipientDomains.length
        ? `已限制 ${settings.scope.recipientDomains.length} 個網域。`
        : "請先設定允許的客戶內部網域。",
      phase: 1,
    },
    {
      id: "sender_scope",
      label: "核准寄件網域",
      status: settings.scope.senderDomains.length ? "ready" : "action_required",
      detail: settings.scope.senderDomains.length
        ? `已登錄 ${settings.scope.senderDomains.length} 個網域，所有權將於寄信階段驗證。`
        : "請登錄客戶擁有且核准的演練寄件網域。",
      phase: 1,
    },
    {
      id: "test_mailboxes",
      label: "測試信箱 allowlist",
      status: settings.scope.testRecipientEmails.length ? "ready" : "action_required",
      detail: settings.scope.testRecipientEmails.length
        ? `已設定 ${settings.scope.testRecipientEmails.length} 個測試信箱。`
        : "正式活動前必須先完成測試寄送。",
      phase: 1,
    },
    {
      id: "audience_workspace",
      label: "名單群組與 CSV 匯入",
      status: "ready",
      detail: "已啟用內部網域限制、XLSX 容器上限與匯入品質摘要。",
      phase: 2,
    },
    {
      id: "template_studio",
      label: "版本化範本與 EML 匯入",
      status: "ready",
      detail: "已啟用離線清理、附件隔離、版本控制與安全預覽。",
      phase: 2,
    },
    {
      id: "template_review",
      label: "範本視覺編輯與雙人審核",
      status: "ready",
      detail: "已啟用版本化編輯、角色權限與 maker-checker。",
      phase: 2,
    },
    {
      id: "mail_connector",
      label: "客戶郵件連接器",
      status: mailSendingEnabled ? "ready" : "action_required",
      detail: mailSendingEnabled
        ? "已有通過測試信箱驗證的連接器，且緊急停止未啟用。"
        : "已提供 pickup 與強制 TLS 的 SMTP adapter；需由客戶完成一次性設定與測試信箱驗證。",
      phase: 3,
    },
    {
      id: "tls_and_backup",
      label: "TLS、備份與 Windows Service",
      status: "action_required",
      detail: "維運腳本已提供；TLS 憑證、服務帳號與備份位置需由客戶部署時設定。",
      phase: 5,
    },
    {
      id: "campaign_engine",
      label: "活動、排程與緊急停止",
      status: "ready",
      detail: "已啟用雙人核准、節流、寄送時窗、重試、抑制與 emergency stop。",
      phase: 3,
    },
    {
      id: "tracking_and_reports",
      label: "事件統計與 Excel／Word 報表",
      status: "ready",
      detail: "開信、點擊、受控附件開啟、稽核匯入與報表已分開計算。",
      phase: 4,
    },
  ];

  return {
    currentPhase: 5,
    mailSendingEnabled,
    readyCount: items.filter((item) => item.status === "ready").length,
    items,
  };
}

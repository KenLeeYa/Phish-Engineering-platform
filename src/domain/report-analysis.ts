export interface NormalizedReportEvent {
  businessUnit: string;
  department: string;
  recipientName: string;
  email: string;
  subject: string;
  attachmentName: string;
  occurredAt: string;
  action: "開啟郵件" | "點閱連結" | "開啟附件" | "完成訓練" | "退信" | "未知";
  source: string;
  actorClass: "human_likely" | "automated_likely" | "unknown";
  confidence: "low" | "medium" | "high";
  sourceIp?: string;
  userAgent?: string;
}

export interface NormalizedReportRecipient {
  email: string;
  recipientName: string;
  department: string;
  businessUnit: string;
  deliveryStatus: string;
}

export interface ReportAnalysis {
  schemaVersion: "2.0";
  campaignName: string;
  sourceFile: string;
  generatedAt: string;
  targetCount: number | null;
  recipients: Array<NormalizedReportRecipient & {
    opened: boolean;
    clicked: boolean;
    attachmentOpened: boolean;
    trainingAcknowledged: boolean;
  }>;
  events: NormalizedReportEvent[];
  aggregates: {
    businessUnits: AggregateRow[];
    departments: AggregateRow[];
    subjects: AggregateRow[];
    attachments: AggregateRow[];
  };
  metrics: {
    eventCount: number;
    targetCount: number | null;
    deliveredCount: number | null;
    observedRecipients: number;
    uniqueOpened: number;
    uniqueClicked: number;
    uniqueAttachmentOpened: number;
    uniqueTrainingAcknowledged: number;
    automatedEventCount: number;
    humanEventCount: number;
    formalOpenRate: number | null;
    formalClickRate: number | null;
    formalAttachmentOpenRate: number | null;
    formalAcknowledgementRate: number | null;
  };
  quality: {
    invalidEmailRows: number;
    invalidTimestampRows: number;
    exactDuplicateRows: number;
    unknownActionRows: number;
    automatedEventCount: number;
    attachmentOpenWithoutNameRows: number;
  };
  warnings: string[];
}

export interface AggregateRow {
  label: string;
  observedRecipients: number;
  openedRecipients: number;
  clickedRecipients: number;
  attachmentOpenedRecipients: number;
  trainingAcknowledgedRecipients: number;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function aggregate(
  events: NormalizedReportEvent[],
  key: (event: NormalizedReportEvent) => string,
): AggregateRow[] {
  const map = new Map<string, {
    observed: Set<string>;
    opened: Set<string>;
    clicked: Set<string>;
    attachments: Set<string>;
    acknowledged: Set<string>;
  }>();
  for (const event of events) {
    const label = key(event) || "未分類";
    if (!map.has(label)) {
      map.set(label, {
        observed: new Set(),
        opened: new Set(),
        clicked: new Set(),
        attachments: new Set(),
        acknowledged: new Set(),
      });
    }
    const item = map.get(label)!;
    item.observed.add(event.email);
    if (event.actorClass === "automated_likely") continue;
    if (event.action === "開啟郵件") item.opened.add(event.email);
    if (event.action === "點閱連結") item.clicked.add(event.email);
    if (event.action === "開啟附件") item.attachments.add(event.email);
    if (event.action === "完成訓練") item.acknowledged.add(event.email);
  }
  return [...map.entries()]
    .map(([label, item]) => ({
      label,
      observedRecipients: item.observed.size,
      openedRecipients: item.opened.size,
      clickedRecipients: item.clicked.size,
      attachmentOpenedRecipients: item.attachments.size,
      trainingAcknowledgedRecipients: item.acknowledged.size,
    }))
    .sort((a, b) => b.clickedRecipients - a.clickedRecipients || a.label.localeCompare(b.label));
}

export function analyzeReport(input: {
  campaignName: string;
  sourceFile: string;
  targetCount: number | null;
  deliveredCount: number | null;
  recipients: NormalizedReportRecipient[];
  events: NormalizedReportEvent[];
}): ReportAnalysis {
  const events = input.events.map((event) => ({ ...event, email: event.email.trim().toLowerCase() }));
  const exact = new Set<string>();
  let exactDuplicateRows = 0;
  let invalidEmailRows = 0;
  let invalidTimestampRows = 0;
  let unknownActionRows = 0;
  let attachmentOpenWithoutNameRows = 0;
  for (const event of events) {
    if (!EMAIL_PATTERN.test(event.email)) invalidEmailRows += 1;
    if (!Number.isFinite(Date.parse(event.occurredAt))) invalidTimestampRows += 1;
    if (event.action === "未知") unknownActionRows += 1;
    if (event.action === "開啟附件" && !event.attachmentName) attachmentOpenWithoutNameRows += 1;
    const key = JSON.stringify(event);
    if (exact.has(key)) exactDuplicateRows += 1;
    exact.add(key);
  }

  const recipientMap = new Map<string, NormalizedReportRecipient>();
  for (const recipient of input.recipients) recipientMap.set(recipient.email.toLowerCase(), recipient);
  for (const event of events) {
    if (!recipientMap.has(event.email)) {
      recipientMap.set(event.email, {
        email: event.email,
        recipientName: event.recipientName,
        department: event.department,
        businessUnit: event.businessUnit,
        deliveryStatus: "observed_only",
      });
    }
  }
  const effectiveEvents = events.filter((event) => event.actorClass !== "automated_likely");
  const eventEmails = (action: NormalizedReportEvent["action"]): Set<string> =>
    new Set(effectiveEvents.filter((event) => event.action === action).map((event) => event.email));
  const opened = eventEmails("開啟郵件");
  const clicked = eventEmails("點閱連結");
  const attachmentOpened = eventEmails("開啟附件");
  const acknowledged = eventEmails("完成訓練");
  const recipients = [...recipientMap.values()]
    .map((recipient) => ({
      ...recipient,
      opened: opened.has(recipient.email.toLowerCase()),
      clicked: clicked.has(recipient.email.toLowerCase()),
      attachmentOpened: attachmentOpened.has(recipient.email.toLowerCase()),
      trainingAcknowledged: acknowledged.has(recipient.email.toLowerCase()),
    }))
    .sort(
      (a, b) =>
        a.businessUnit.localeCompare(b.businessUnit) ||
        a.department.localeCompare(b.department) ||
        a.recipientName.localeCompare(b.recipientName),
    );

  const targetCount = input.targetCount;
  if (targetCount !== null && targetCount < recipients.length) {
    throw new Error("活動總寄送人數不可小於名單或已觀測的不重複受測者人數。");
  }
  const rate = (count: number): number | null => targetCount ? count / targetCount : null;
  const warnings: string[] = [];
  if (targetCount === null) warnings.push("未提供完整活動分母；正式開信率、點閱率與附件開啟率不計算。");
  if (input.deliveredCount === null) warnings.push("未取得郵件伺服器 DSN／投遞證據；寄送端接受不等於實際送達。");
  if (events.some((event) => event.action === "開啟郵件")) warnings.push("開信事件可能受圖片代理與郵件用戶端自動載入影響，信心等級通常較低。");
  if (events.some((event) => event.actorClass === "automated_likely")) warnings.push("已辨識的自動掃描事件不納入人員行為率，但保留在 rawdata 與資料品質頁。");
  if (attachmentOpenWithoutNameRows) warnings.push("部分附件開啟紀錄缺少附件名稱，需向來源稽核系統確認。");

  return {
    schemaVersion: "2.0",
    campaignName: input.campaignName,
    sourceFile: input.sourceFile,
    generatedAt: new Date().toISOString(),
    targetCount,
    recipients,
    events,
    aggregates: {
      businessUnits: aggregate(events, (event) => event.businessUnit),
      departments: aggregate(events, (event) => event.department),
      subjects: aggregate(events, (event) => event.subject),
      attachments: aggregate(
        events.filter((event) => event.attachmentName),
        (event) => event.attachmentName,
      ),
    },
    metrics: {
      eventCount: events.length,
      targetCount,
      deliveredCount: input.deliveredCount,
      observedRecipients: new Set(events.map((event) => event.email)).size,
      uniqueOpened: opened.size,
      uniqueClicked: clicked.size,
      uniqueAttachmentOpened: attachmentOpened.size,
      uniqueTrainingAcknowledged: acknowledged.size,
      automatedEventCount: events.filter((event) => event.actorClass === "automated_likely").length,
      humanEventCount: events.filter((event) => event.actorClass === "human_likely").length,
      formalOpenRate: rate(opened.size),
      formalClickRate: rate(clicked.size),
      formalAttachmentOpenRate: rate(attachmentOpened.size),
      formalAcknowledgementRate: rate(acknowledged.size),
    },
    quality: {
      invalidEmailRows,
      invalidTimestampRows,
      exactDuplicateRows,
      unknownActionRows,
      automatedEventCount: events.filter((event) => event.actorClass === "automated_likely").length,
      attachmentOpenWithoutNameRows,
    },
    warnings,
  };
}

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import {
  analyzeReport,
  type AggregateRow,
  type NormalizedReportEvent,
  type NormalizedReportRecipient,
  type ReportAnalysis,
} from "../domain/report-analysis.js";
import type { CampaignStore } from "../infrastructure/campaign-store.js";
import {
  ReportArtifactNotFoundError,
  ReportStore,
  type ReportArtifact,
} from "../infrastructure/report-store.js";
import {
  SpreadsheetInputLimitError,
  SpreadsheetRuntime,
  SpreadsheetRuntimeUnavailableError,
  type ArtifactSheet,
} from "../infrastructure/spreadsheet-runtime.js";
import { AppError, type PublicUser } from "./platform-service.js";

const REQUIRED_VENDOR_HEADERS = [
  "部群",
  "部門",
  "受測人",
  "E-mail",
  "郵件主旨",
  "附件檔名",
  "存取日期",
  "動作",
  "來源IP",
  "Agent",
];
const AUTOMATION_MARKERS = ["proofpoint", "barracuda", "mimecast", "urlscan", "safelinks", "curl/", "wget/", "headless"];

function safeFileStem(value: string): string {
  return value.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_").trim().slice(0, 80) || "security-awareness-report";
}

function boundedReportText(value: unknown, maximum = 500): string {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, maximum);
}

function spreadsheetText(value: unknown, maximum = 500): string {
  const text = boundedReportText(value, maximum);
  return /^[=+@-]/.test(text) ? `'${text}` : text;
}

function internalAction(value: string): NormalizedReportEvent["action"] {
  const map: Record<string, NormalizedReportEvent["action"]> = {
    email_opened: "開啟郵件",
    link_clicked: "點閱連結",
    attachment_opened: "開啟附件",
    training_acknowledged: "完成訓練",
    delivery_bounced: "退信",
  };
  return map[value] ?? "未知";
}

function vendorAction(value: string): NormalizedReportEvent["action"] {
  const normalized = value.trim();
  if (normalized === "開啟郵件") return "開啟郵件";
  if (normalized === "點閱連結") return "點閱連結";
  if (normalized === "開啟附件") return "開啟附件";
  return "未知";
}

function timestampValue(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Math.round((value - 25_569) * 86_400_000)).toISOString();
  }
  const text = String(value ?? "").trim();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text;
}

function findVendorHeader(values: unknown[][]): { headerIndex: number; indexes: Record<string, number> } {
  for (let index = 0; index < Math.min(values.length, 20); index += 1) {
    const row = (values[index] ?? []).map((value) => String(value ?? "").trim());
    if (REQUIRED_VENDOR_HEADERS.every((header) => row.includes(header))) {
      return {
        headerIndex: index,
        indexes: Object.fromEntries(REQUIRED_VENDOR_HEADERS.map((header) => [header, row.indexOf(header)])),
      };
    }
  }
  throw new AppError(400, "VENDOR_HEADERS_MISSING", `找不到必要欄位：${REQUIRED_VENDOR_HEADERS.join("、")}`);
}

function percent(value: number | null): string {
  return value === null ? "未計算" : `${(value * 100).toFixed(1)}%`;
}

function styleSheetHeader(range: any): void {
  range.format = {
    fill: "#9FBAD0",
    font: { bold: true, color: "#17324D" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "all", style: "thin", color: "#CCD5DD" },
  };
  range.format.rowHeight = 26;
}

function styleSheetBody(range: any): void {
  range.format = {
    verticalAlignment: "center",
    borders: {
      insideHorizontal: { style: "thin", color: "#E2E8F0" },
      bottom: { style: "thin", color: "#CBD5E1" },
    },
  };
}

function setWidths(sheet: ArtifactSheet, widths: number[], rows: number): void {
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, Math.max(rows, 1), 1).format.columnWidth = width;
  });
}

function aggregateTable(label: string, rows: AggregateRow[]): Array<Array<string | number>> {
  return [
    [label, "已觀測人數", "開啟人數", "點閱人數", "附件開啟人數", "完成訓練人數"],
    ...rows.map((row) => [
      spreadsheetText(row.label),
      row.observedRecipients,
      row.openedRecipients,
      row.clickedRecipients,
      row.attachmentOpenedRecipients,
      row.trainingAcknowledgedRecipients,
    ]),
  ];
}

const TABLE_BORDER = { style: BorderStyle.SINGLE, size: 2, color: "CCD5DD" };
const TABLE_BORDERS = {
  top: TABLE_BORDER,
  bottom: TABLE_BORDER,
  left: TABLE_BORDER,
  right: TABLE_BORDER,
  insideHorizontal: TABLE_BORDER,
  insideVertical: TABLE_BORDER,
};

function wordCell(
  text: string,
  width: number,
  header = false,
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT,
): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    shading: header ? { type: ShadingType.CLEAR, fill: "F2F4F7", color: "auto" } : undefined,
    children: [
      new Paragraph({
        alignment,
        spacing: { before: 0, after: 0, line: 264 },
        children: [new TextRun({ text, bold: header, font: "Calibri", size: 20, color: "17324D" })],
      }),
    ],
  });
}

function wordTable(headers: string[], rows: string[][], widths: number[]): Table {
  return new Table({
    width: { size: 9_360, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    indent: { size: 120, type: WidthType.DXA },
    borders: TABLE_BORDERS,
    rows: [
      new TableRow({ children: headers.map((header, index) => wordCell(header, widths[index] ?? 1_000, true, AlignmentType.CENTER)) }),
      ...rows.map((row) => new TableRow({ children: row.map((cell, index) => wordCell(cell, widths[index] ?? 1_000)) })),
    ],
  });
}

function topAggregateRows(rows: AggregateRow[], maximum = 8): string[][] {
  return rows.slice(0, maximum).map((row) => [
    row.label,
    String(row.observedRecipients),
    String(row.clickedRecipients),
    String(row.attachmentOpenedRecipients),
  ]);
}

export class ReportService {
  private generationActive = false;

  constructor(
    private readonly campaignStore: CampaignStore,
    private readonly reportStore: ReportStore,
    private readonly spreadsheets: SpreadsheetRuntime,
    private readonly reportDirectory: string,
  ) {}

  async generateCampaignReport(user: PublicUser, campaignId: string) {
    return this.withGenerationLock(async () => {
    let campaign;
    try {
      campaign = this.campaignStore.getCampaign(campaignId);
    } catch {
      throw new AppError(404, "CAMPAIGN_NOT_FOUND", "找不到指定演練活動。");
    }
    const recipients = this.reportStore.campaignRecipients(campaignId);
    const rows = this.campaignStore.reportRows(campaignId);
    const analysis = analyzeReport({
      campaignName: campaign.name,
      sourceFile: "platform-events",
      targetCount: campaign.metrics.targetCount || recipients.length || null,
      deliveredCount: campaign.metrics.deliveredCount,
      recipients,
      events: rows.map((row) => ({
        businessUnit: row.businessUnit,
        department: row.department,
        recipientName: row.recipientName,
        email: row.email,
        subject: row.subject,
        attachmentName: row.attachmentName,
        occurredAt: row.occurredAt,
        action: internalAction(row.action),
        source: row.source,
        actorClass: row.actorClass as NormalizedReportEvent["actorClass"],
        confidence: row.confidence as NormalizedReportEvent["confidence"],
        sourceIp: "",
        userAgent: "",
      })),
    });
      return this.writeArtifacts(user, analysis, { campaignId, externalJobId: null });
    });
  }

  listArtifacts() {
    return this.reportStore.listArtifacts().map(({ filePath: _filePath, ...artifact }) => artifact);
  }

  async generateVendorReport(
    user: PublicUser,
    buffer: Buffer,
    options: { sourceFileName: string; campaignName: string; targetCount: number | null },
  ) {
    return this.withGenerationLock(async () => {
    if (!buffer.length || buffer.length > 25 * 1024 * 1024) {
      throw new AppError(413, "XLSX_SIZE_INVALID", "rawdata XLSX 必須介於 1 byte 與 25 MB。");
    }
    let values: unknown[][];
    try {
      values = await this.spreadsheets.readFirstWorksheet(buffer, "rawdata");
    } catch (error) {
      if (error instanceof SpreadsheetRuntimeUnavailableError) {
        throw new AppError(503, "SPREADSHEET_RUNTIME_REQUIRED", error.message);
      }
      if (error instanceof SpreadsheetInputLimitError) {
        throw new AppError(413, "XLSX_LIMIT_REJECTED", error.message);
      }
      throw new AppError(400, "INVALID_XLSX", "rawdata XLSX 無法解析。");
    }
    const { headerIndex, indexes } = findVendorHeader(values);
    const events: NormalizedReportEvent[] = values.slice(headerIndex + 1).flatMap((row) => {
      const value = (header: string): unknown => row[indexes[header] ?? -1];
      const email = boundedReportText(value("E-mail"), 254).toLowerCase();
      const actionValue = boundedReportText(value("動作"), 40);
      if (!email && !actionValue) return [];
      const agent = boundedReportText(value("Agent"), 500).toLowerCase();
      const automated = AUTOMATION_MARKERS.some((marker) => agent.includes(marker));
      const action = vendorAction(actionValue);
      return [{
        businessUnit: boundedReportText(value("部群"), 120),
        department: boundedReportText(value("部門"), 120),
        recipientName: boundedReportText(value("受測人"), 120),
        email,
        subject: boundedReportText(value("郵件主旨"), 300),
        attachmentName: boundedReportText(value("附件檔名"), 260).replace(/^\.無附件$/, "").trim(),
        occurredAt: timestampValue(value("存取日期")),
        action,
        source: "vendor_rawdata_import",
        actorClass: automated ? "automated_likely" : "unknown",
        confidence: action === "開啟附件" ? "high" : action === "點閱連結" ? "medium" : "low",
        sourceIp: boundedReportText(value("來源IP"), 80),
        userAgent: boundedReportText(value("Agent"), 500),
      } satisfies NormalizedReportEvent];
    });
    const analysis = analyzeReport({
      campaignName: options.campaignName,
      sourceFile: path.basename(options.sourceFileName),
      targetCount: options.targetCount,
      deliveredCount: null,
      recipients: [],
      events,
    });
    const externalJobId = crypto.randomUUID();
    this.reportStore.createExternalJob({
      id: externalJobId,
      sourceFileName: path.basename(options.sourceFileName),
      targetCount: options.targetCount,
      userId: user.id,
      occurredAt: new Date().toISOString(),
    });
      return this.writeArtifacts(user, analysis, { campaignId: null, externalJobId });
    });
  }

  async getArtifact(artifactId: string): Promise<{ artifact: ReportArtifact; content: Buffer }> {
    let artifact: ReportArtifact;
    try {
      artifact = this.reportStore.getArtifact(artifactId);
    } catch (error) {
      if (error instanceof ReportArtifactNotFoundError) throw new AppError(404, "ARTIFACT_NOT_FOUND", error.message);
      throw error;
    }
    const root = path.resolve(this.reportDirectory);
    const resolved = path.resolve(artifact.filePath);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new AppError(500, "ARTIFACT_PATH_REJECTED", "報表檔案路徑不在允許範圍內。");
    }
    try {
      if (artifact.sizeBytes > 100 * 1024 * 1024) {
        throw new AppError(413, "ARTIFACT_TOO_LARGE", "報表檔案超過下載大小上限。");
      }
      const stats = await fs.stat(resolved);
      if (stats.size !== artifact.sizeBytes || stats.size > 100 * 1024 * 1024) {
        throw new AppError(409, "ARTIFACT_SIZE_MISMATCH", "報表檔案大小與稽核紀錄不一致。");
      }
      const content = await fs.readFile(resolved);
      const digest = crypto.createHash("sha256").update(content).digest("hex");
      if (digest !== artifact.sha256) throw new AppError(409, "ARTIFACT_HASH_MISMATCH", "報表檔案完整性驗證失敗。");
      return { artifact, content };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(404, "ARTIFACT_FILE_MISSING", "報表檔案不存在。");
    }
  }

  private async writeArtifacts(
    user: PublicUser,
    analysis: ReportAnalysis,
    owner: { campaignId: string | null; externalJobId: string | null },
  ) {
    if (this.reportStore.totalArtifactCount() >= 3_000) {
      throw new AppError(507, "REPORT_STORAGE_LIMIT", "報表保留量已達上限，請先執行保存期限維護。");
    }
    const jobId = owner.campaignId ?? owner.externalJobId ?? crypto.randomUUID();
    const directory = path.join(this.reportDirectory, jobId, crypto.randomUUID());
    await fs.mkdir(directory, { recursive: true });
    const stem = safeFileStem(analysis.campaignName);
    const paths = {
      xlsx: path.join(directory, `${stem}-結果.xlsx`),
      docx: path.join(directory, `${stem}-報告.docx`),
      json: path.join(directory, `${stem}-分析.json`),
    };
    try {
      await this.buildWorkbook(analysis, paths.xlsx);
      await this.buildWordReport(analysis, paths.docx);
      await fs.writeFile(paths.json, `${JSON.stringify(analysis, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true });
      if (error instanceof SpreadsheetRuntimeUnavailableError) {
        throw new AppError(503, "SPREADSHEET_RUNTIME_REQUIRED", error.message);
      }
      throw error;
    }
    const artifacts: ReportArtifact[] = [];
    for (const format of ["xlsx", "docx", "json"] as const) {
      const content = await fs.readFile(paths[format]);
      artifacts.push(this.reportStore.saveArtifact({
        id: crypto.randomUUID(),
        campaignId: owner.campaignId,
        externalJobId: owner.externalJobId,
        format,
        fileName: path.basename(paths[format]),
        filePath: paths[format],
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
        sizeBytes: content.length,
        userId: user.id,
        occurredAt: new Date().toISOString(),
      }));
    }
    return {
      analysis: {
        metrics: analysis.metrics,
        quality: analysis.quality,
        warnings: analysis.warnings,
      },
      artifacts: artifacts.map(({ filePath: _filePath, ...artifact }) => artifact),
    };
  }

  private async withGenerationLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.generationActive) {
      throw new AppError(429, "REPORT_GENERATION_BUSY", "已有報表正在產生，請稍後再試。");
    }
    this.generationActive = true;
    try {
      return await operation();
    } finally {
      this.generationActive = false;
    }
  }

  private async buildWorkbook(analysis: ReportAnalysis, outputPath: string): Promise<void> {
    const { artifact, workbook } = await this.spreadsheets.createWorkbook();
    const summary = workbook.worksheets.add("摘要");
    const units = workbook.worksheets.add("部群分析");
    const departments = workbook.worksheets.add("部門分析");
    const subjects = workbook.worksheets.add("主旨分析");
    const attachments = workbook.worksheets.add("附件分析");
    const recipients = workbook.worksheets.add("受測者彙總");
    const raw = workbook.worksheets.add("rawdata");
    const quality = workbook.worksheets.add("資料品質");
    for (const sheet of [summary, units, departments, subjects, attachments, recipients, raw, quality]) {
      sheet.showGridLines = false;
    }

    const rawRows: Array<Array<string | number>> = [
      ["部群", "部門", "受測人", "E-mail", "郵件主旨", "附件檔名", "存取日期", "動作", "來源IP", "Agent", "來源", "行為分類", "信心等級"],
      ...analysis.events.map((event) => [
        spreadsheetText(event.businessUnit, 120),
        spreadsheetText(event.department, 120),
        spreadsheetText(event.recipientName, 120),
        spreadsheetText(event.email, 254),
        spreadsheetText(event.subject, 300),
        spreadsheetText(event.attachmentName, 260),
        spreadsheetText(event.occurredAt, 80),
        spreadsheetText(event.action, 40),
        spreadsheetText(event.sourceIp ?? "", 80),
        spreadsheetText(event.userAgent ?? "", 500),
        spreadsheetText(event.source, 80),
        spreadsheetText(event.actorClass, 40),
        spreadsheetText(event.confidence, 20),
      ]),
    ];
    raw.getRange(`A1:M${rawRows.length}`).values = rawRows;
    styleSheetHeader(raw.getRange("A1:M1"));
    if (rawRows.length > 1) {
      styleSheetBody(raw.getRange(`A2:M${rawRows.length}`));
      raw.tables.add(`A1:M${rawRows.length}`, true, "RawEventsTable").style = "TableStyleMedium2";
    }
    raw.freezePanes.freezeRows(1);
    setWidths(raw, [14, 28, 18, 30, 52, 28, 23, 16, 18, 48, 24, 20, 14], rawRows.length);

    const recipientRows: Array<Array<string | number>> = [
      ["E-mail", "受測人", "部群", "部門", "寄送狀態", "曾開啟", "曾點閱", "曾開啟附件", "完成訓練"],
      ...analysis.recipients.map((recipient) => [
        spreadsheetText(recipient.email, 254),
        spreadsheetText(recipient.recipientName, 120),
        spreadsheetText(recipient.businessUnit, 120),
        spreadsheetText(recipient.department, 120),
        spreadsheetText(recipient.deliveryStatus, 40),
        0,
        0,
        0,
        0,
      ]),
    ];
    recipients.getRange(`A1:I${recipientRows.length}`).values = recipientRows;
    if (recipientRows.length > 1) {
      const rawEnd = rawRows.length;
      recipients.getRange(`F2:F${recipientRows.length}`).formulas = analysis.recipients.map((_, index) => [
        `=IF(COUNTIFS('rawdata'!$D$2:$D$${rawEnd},A${index + 2},'rawdata'!$H$2:$H$${rawEnd},"開啟郵件",'rawdata'!$L$2:$L$${rawEnd},"<>automated_likely")>0,1,0)`,
      ]);
      recipients.getRange(`G2:G${recipientRows.length}`).formulas = analysis.recipients.map((_, index) => [
        `=IF(COUNTIFS('rawdata'!$D$2:$D$${rawEnd},A${index + 2},'rawdata'!$H$2:$H$${rawEnd},"點閱連結",'rawdata'!$L$2:$L$${rawEnd},"<>automated_likely")>0,1,0)`,
      ]);
      recipients.getRange(`H2:H${recipientRows.length}`).formulas = analysis.recipients.map((_, index) => [
        `=IF(COUNTIFS('rawdata'!$D$2:$D$${rawEnd},A${index + 2},'rawdata'!$H$2:$H$${rawEnd},"開啟附件",'rawdata'!$L$2:$L$${rawEnd},"<>automated_likely")>0,1,0)`,
      ]);
      recipients.getRange(`I2:I${recipientRows.length}`).formulas = analysis.recipients.map((_, index) => [
        `=IF(COUNTIFS('rawdata'!$D$2:$D$${rawEnd},A${index + 2},'rawdata'!$H$2:$H$${rawEnd},"完成訓練",'rawdata'!$L$2:$L$${rawEnd},"<>automated_likely")>0,1,0)`,
      ]);
      recipients.getRange(`F2:I${recipientRows.length}`).conditionalFormats.add("cellIs", {
        operator: "equal",
        formula: 1,
        format: { fill: "#DCFCE7", font: { bold: true, color: "#166534" } },
      });
      styleSheetBody(recipients.getRange(`A2:I${recipientRows.length}`));
    }
    styleSheetHeader(recipients.getRange("A1:I1"));
    recipients.freezePanes.freezeRows(1);
    setWidths(recipients, [30, 18, 16, 28, 16, 12, 12, 16, 14], recipientRows.length);

    const buildAggregateSheet = (sheet: ArtifactSheet, label: string, values: AggregateRow[]) => {
      const rows = aggregateTable(label, values);
      sheet.getRange(`A1:F${rows.length}`).values = rows;
      styleSheetHeader(sheet.getRange("A1:F1"));
      if (rows.length > 1) styleSheetBody(sheet.getRange(`A2:F${rows.length}`));
      sheet.freezePanes.freezeRows(1);
      setWidths(sheet, [label === "部門" ? 48 : 38, 18, 16, 16, 20, 18], rows.length);
    };
    buildAggregateSheet(units, "部群", analysis.aggregates.businessUnits);
    buildAggregateSheet(departments, "部門", analysis.aggregates.departments);
    buildAggregateSheet(subjects, "郵件主旨", analysis.aggregates.subjects);
    buildAggregateSheet(attachments, "附件檔名", analysis.aggregates.attachments);

    summary.mergeCells("A1:L1");
    summary.getRange("A1").values = [["社交工程郵件演練結果摘要"]];
    summary.getRange("A1:L1").format = {
      fill: "#315E7D",
      font: { bold: true, color: "#FFFFFF", size: 18 },
      verticalAlignment: "center",
    };
    summary.getRange("A1:L1").format.rowHeight = 34;
    summary.mergeCells("A2:L2");
    summary.getRange("A2").values = [[`${analysis.campaignName}｜來源：${analysis.sourceFile}｜產生：${analysis.generatedAt}`]];
    summary.getRange("A2:L2").format = { fill: "#F2F4F7", font: { color: "#475569", italic: true } };
    const targetFormula = analysis.targetCount === null ? "" : String(analysis.targetCount);
    summary.getRange("A4:F8").values = [
      ["正式分母", "開啟人數", "點閱人數", "附件開啟人數", "完成訓練人數", "自動事件數"],
      [targetFormula || "未提供", analysis.metrics.uniqueOpened, analysis.metrics.uniqueClicked, analysis.metrics.uniqueAttachmentOpened, analysis.metrics.uniqueTrainingAcknowledged, analysis.metrics.automatedEventCount],
      ["正式開信率", "正式點閱率", "正式附件開啟率", "完成訓練率", "事件總數", "已觀測人數"],
      [percent(analysis.metrics.formalOpenRate), percent(analysis.metrics.formalClickRate), percent(analysis.metrics.formalAttachmentOpenRate), percent(analysis.metrics.formalAcknowledgementRate), analysis.metrics.eventCount, analysis.metrics.observedRecipients],
      [analysis.warnings.join("；") || "未發現需特別揭露的資料品質限制。", "", "", "", "", ""],
    ];
    styleSheetHeader(summary.getRange("A4:F4"));
    styleSheetHeader(summary.getRange("A6:F6"));
    summary.mergeCells("A8:F8");
    summary.getRange("A8:F8").format = {
      fill: analysis.warnings.length ? "#FEF3C7" : "#DCFCE7",
      font: { color: analysis.warnings.length ? "#854D0E" : "#166534", bold: true },
      wrapText: true,
      borders: { preset: "outside", style: "thin", color: "#CCD5DD" },
    };
    summary.getRange("A10:B15").values = [
      ["行為", "不重複人數"],
      ["開啟郵件", analysis.metrics.uniqueOpened],
      ["點閱連結", analysis.metrics.uniqueClicked],
      ["開啟附件", analysis.metrics.uniqueAttachmentOpened],
      ["完成訓練", analysis.metrics.uniqueTrainingAcknowledged],
      ["自動事件", analysis.metrics.automatedEventCount],
    ];
    styleSheetHeader(summary.getRange("A10:B10"));
    styleSheetBody(summary.getRange("A11:B15"));
    const chart = summary.charts.add("bar", summary.getRange("A10:B15"));
    chart.title = "人員行為與自動事件分開呈現";
    chart.hasLegend = false;
    chart.xAxis = { axisType: "textAxis", textStyle: { fontSize: 10 } };
    chart.yAxis = { numberFormatCode: "#,##0" };
    chart.setPosition("D10", "L25");
    setWidths(summary, [20, 18, 18, 20, 18, 16, 3, 16, 16, 16, 16, 16], 30);

    quality.getRange("A1:B8").values = [
      ["資料品質檢查", "數量"],
      ["Email 格式錯誤", analysis.quality.invalidEmailRows],
      ["時間無法解析", analysis.quality.invalidTimestampRows],
      ["完全重複事件", analysis.quality.exactDuplicateRows],
      ["未知動作", analysis.quality.unknownActionRows],
      ["自動掃描事件", analysis.quality.automatedEventCount],
      ["附件開啟缺少檔名", analysis.quality.attachmentOpenWithoutNameRows],
      ["正式分母", analysis.targetCount ?? "未提供"],
    ];
    styleSheetHeader(quality.getRange("A1:B1"));
    styleSheetBody(quality.getRange("A2:B8"));
    setWidths(quality, [34, 18], 8);
    quality.freezePanes.freezeRows(1);

    await workbook.inspect({ kind: "sheet,table,drawing", maxChars: 4_000, tableMaxRows: 4, tableMaxCols: 6 });
    const exported = await artifact.SpreadsheetFile.exportXlsx(workbook);
    await exported.save(outputPath);
    await fs.rm(`${outputPath}.inspect.ndjson`, { force: true });
  }

  private async buildWordReport(analysis: ReportAnalysis, outputPath: string): Promise<void> {
    const children: Array<Paragraph | Table> = [
      new Paragraph({
        spacing: { before: 0, after: 80 },
        children: [new TextRun({ text: "SOCIAL ENGINEERING AWARENESS REPORT", font: "Calibri", size: 20, bold: true, color: "64748B" })],
      }),
      new Paragraph({
        spacing: { before: 0, after: 80 },
        children: [new TextRun({ text: analysis.campaignName, font: "Calibri", size: 46, bold: true, color: "17324D" })],
      }),
      new Paragraph({
        spacing: { before: 0, after: 320 },
        children: [new TextRun({ text: "授權型內部社交工程郵件演練結果", font: "Calibri", size: 28, color: "475569" })],
      }),
      wordTable(
        ["項目", "內容"],
        [
          ["資料來源", analysis.sourceFile],
          ["報告產生時間", analysis.generatedAt],
          ["活動分母", analysis.targetCount === null ? "未提供，不計算正式率" : `${analysis.targetCount} 人`],
          ["資料分級", "Word 僅包含彙總結果；逐人明細只存在 Excel 與平台權限控管內"],
        ],
        [2_700, 6_660],
      ),
      new Paragraph({ text: "執行摘要", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({
        children: [new TextRun({ text: `本次資料共 ${analysis.metrics.eventCount} 筆事件，涵蓋 ${analysis.metrics.observedRecipients} 位已觀測受測者。已辨識的自動掃描事件共 ${analysis.metrics.automatedEventCount} 筆，未納入人員行為率。` })],
      }),
      wordTable(
        ["指標", "不重複人數", "正式率"],
        [
          ["開啟郵件", String(analysis.metrics.uniqueOpened), percent(analysis.metrics.formalOpenRate)],
          ["點閱連結", String(analysis.metrics.uniqueClicked), percent(analysis.metrics.formalClickRate)],
          ["開啟附件", String(analysis.metrics.uniqueAttachmentOpened), percent(analysis.metrics.formalAttachmentOpenRate)],
          ["完成訓練", String(analysis.metrics.uniqueTrainingAcknowledged), percent(analysis.metrics.formalAcknowledgementRate)],
        ],
        [3_600, 2_400, 3_360],
      ),
      new Paragraph({ text: "組織觀察", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: "下表僅呈現彙總，不建立公開個人排行榜。建議用於安排分層教育與流程改善。" }),
      wordTable(
        ["部群", "已觀測", "點閱", "附件開啟"],
        topAggregateRows(analysis.aggregates.businessUnits),
        [3_960, 1_800, 1_800, 1_800],
      ),
      new Paragraph({ text: "主旨與附件觀察", heading: HeadingLevel.HEADING_1 }),
      wordTable(
        ["主旨", "已觀測", "點閱", "附件開啟"],
        topAggregateRows(analysis.aggregates.subjects, 6),
        [4_860, 1_500, 1_500, 1_500],
      ),
      new Paragraph({ text: "資料品質與解讀限制", heading: HeadingLevel.HEADING_1 }),
      ...analysis.warnings.map((warning) => new Paragraph({ text: warning, bullet: { level: 0 } })),
      new Paragraph({
        text: "受控附件入口的開啟可由平台精確記錄；真正附加在郵件中的檔案是否於郵件程式開啟，僅接受客戶郵件閘道或端點稽核資料匯入，不以主動文件或遠端範本推測。",
        bullet: { level: 0 },
      }),
      new Paragraph({ text: "建議後續措施", heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ text: "針對高風險部門安排情境式再訓練，並於下一期沿用相同分母與分類規則比較趨勢。", bullet: { level: 0 } }),
      new Paragraph({ text: "將自動掃描器與人員行為分開檢視，避免安全產品預覽造成誤判。", bullet: { level: 0 } }),
      new Paragraph({ text: "保留活動核准、寄送、緊急停止與報表雜湊稽核軌跡。", bullet: { level: 0 } }),
    ];
    if (!analysis.warnings.length) {
      children.splice(children.length - 4, 0, new Paragraph({ text: "目前資料未出現額外警示；仍應保留原始事件與稽核來源。", bullet: { level: 0 } }));
    }

    const document = new Document({
      creator: "Local Awareness Platform",
      title: `${analysis.campaignName}結果報告`,
      subject: "授權型社交工程郵件演練結果",
      description: "聚合報告，不包含逐人敏感明細。",
      styles: {
        default: {
          document: {
            run: { font: "Calibri", size: 22, color: "17324D" },
            paragraph: { spacing: { before: 0, after: 120, line: 264 } },
          },
        },
        paragraphStyles: [
          {
            id: "Heading1",
            name: "Heading 1",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: { font: "Calibri", size: 32, bold: true, color: "2E74B5" },
            paragraph: { spacing: { before: 320, after: 160 }, keepNext: true },
          },
          {
            id: "Heading2",
            name: "Heading 2",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: { font: "Calibri", size: 26, bold: true, color: "2E74B5" },
            paragraph: { spacing: { before: 240, after: 120 }, keepNext: true },
          },
        ],
      },
      sections: [{
        properties: {
          page: {
            size: { width: 12_240, height: 15_840, orientation: PageOrientation.PORTRAIT },
            margin: { top: 1_440, right: 1_440, bottom: 1_440, left: 1_440, header: 708, footer: 708 },
          },
        },
        headers: {
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { after: 0 },
              children: [new TextRun({ text: "社交工程郵件演練｜內部使用", font: "Calibri", size: 17, color: "64748B" })],
            })],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { before: 0, after: 0 },
              children: [new TextRun({ children: ["第 ", PageNumber.CURRENT, " 頁"], font: "Calibri", size: 17, color: "64748B" })],
            })],
          }),
        },
        children,
      }],
    });
    await fs.writeFile(outputPath, await Packer.toBuffer(document), { mode: 0o600 });
  }
}

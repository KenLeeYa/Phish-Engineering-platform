const views = {
  loading: document.querySelector("#loadingView"),
  setup: document.querySelector("#setupView"),
  login: document.querySelector("#loginView"),
  password: document.querySelector("#passwordView"),
  dashboard: document.querySelector("#dashboardView"),
};

const logoutButton = document.querySelector("#logoutButton");
const toast = document.querySelector("#toast");
const workspaceState = {
  groups: [],
  templates: [],
  connectors: [],
  campaigns: [],
  users: [],
  selectedGroupId: null,
  selectedTemplateId: null,
  selectedTemplate: null,
  selectedCampaignId: null,
  selectedCampaign: null,
  currentUser: null,
};
let toastTimer;

function hasRole(...roles) {
  return roles.includes(workspaceState.currentUser?.role);
}

function canManageCampaigns() {
  return hasRole("system_admin", "campaign_creator");
}

function canGenerateReports() {
  return hasRole("system_admin", "report_viewer");
}

function showView(name) {
  for (const [key, element] of Object.entries(views)) element.classList.toggle("hidden", key !== name);
  logoutButton.classList.toggle("hidden", name !== "dashboard");
}

function cookieValue(name) {
  for (const part of document.cookie.split(";")) {
    const [cookieName, ...valueParts] = part.trim().split("=");
    if (cookieName === name) return decodeURIComponent(valueParts.join("="));
  }
  return "";
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("Accept", "application/json");
  if (options.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const csrf = cookieValue("sea_csrf");
  if (csrf && !["GET", "HEAD"].includes(options.method ?? "GET")) {
    headers.set("X-CSRF-Token", csrf);
  }
  const response = await fetch(path, { ...options, headers });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `請求失敗（${response.status}）`);
  }
  return payload;
}

function setFormState(form, busy, message = "") {
  const button = form.querySelector("button[type='submit']");
  const output = form.querySelector("[data-form-message]");
  button.disabled = busy;
  output.textContent = message;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.remove("hidden");
  toastTimer = window.setTimeout(() => toast.classList.add("hidden"), 3200);
}

function lines(value) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function fillSettings(settings) {
  const form = document.querySelector("#settingsForm");
  form.elements.organizationName.value = settings.organization.name;
  form.elements.timezone.value = settings.organization.timezone;
  form.elements.retentionDays.value = settings.organization.retentionDays;
  if (!settings.scope) return;
  form.elements.recipientDomains.value = settings.scope.recipientDomains.join("\n");
  form.elements.senderDomains.value = settings.scope.senderDomains.join("\n");
  form.elements.testRecipientEmails.value = settings.scope.testRecipientEmails.join("\n");
}

function renderReadiness(readiness) {
  const list = document.querySelector("#readinessList");
  list.replaceChildren();
  for (const item of readiness.items) {
    const row = document.createElement("article");
    row.className = "readiness-item";
    row.dataset.status = item.status;

    const icon = document.createElement("span");
    icon.className = "readiness-icon";
    icon.textContent = item.status === "ready" ? "✓" : item.status === "planned" ? "→" : "!";

    const copy = document.createElement("div");
    copy.className = "readiness-copy";
    const title = document.createElement("strong");
    title.textContent = item.label;
    const detail = document.createElement("small");
    detail.textContent = item.detail;
    copy.append(title, detail);

    const phase = document.createElement("span");
    phase.className = "readiness-phase";
    phase.textContent = `Phase ${item.phase}`;
    row.append(icon, copy, phase);
    list.append(row);
  }
  document.querySelector("#readyCount").textContent = String(readiness.readyCount);
  document.querySelector("#readinessTotal").textContent = `共 ${readiness.items.length} 項`;
}

function emptyState(message) {
  const paragraph = document.createElement("p");
  paragraph.className = "empty-state";
  paragraph.textContent = message;
  return paragraph;
}

function activateWorkspace(name) {
  for (const tab of document.querySelectorAll("[data-workspace-target]")) {
    tab.classList.toggle("active", tab.dataset.workspaceTarget === name);
  }
  for (const panel of document.querySelectorAll("[data-workspace-panel]")) {
    panel.classList.toggle("hidden", panel.dataset.workspacePanel !== name);
  }
  if (name === "audiences") return loadGroups();
  if (name === "templates") return loadTemplates();
  if (name === "campaigns") return loadCampaignWorkspace();
  if (name === "reports") return loadReports();
  if (name === "operations") return loadOperations();
  return Promise.resolve();
}

function renderGroupList() {
  const list = document.querySelector("#groupList");
  const select = document.querySelector("#csvGroupSelect");
  list.replaceChildren();
  select.replaceChildren();

  if (!workspaceState.groups.length) {
    list.append(emptyState("尚未建立群組。請先建立群組，再匯入 CSV 名單。"));
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "請先建立群組";
    select.append(option);
    select.disabled = true;
    return;
  }

  select.disabled = false;
  for (const group of workspaceState.groups) {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = `${group.name}（${group.recipientCount}）`;
    option.selected = group.id === workspaceState.selectedGroupId;
    select.append(option);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "list-button";
    button.classList.toggle("active", group.id === workspaceState.selectedGroupId);
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = group.name;
    const detail = document.createElement("small");
    detail.textContent = group.description || "未填寫說明";
    copy.append(name, detail);
    const count = document.createElement("span");
    count.className = "list-meta";
    count.textContent = `${group.recipientCount} 人`;
    button.append(copy, count);
    button.addEventListener("click", () => loadGroupDetail(group.id));
    list.append(button);
  }
}

function renderGroupDetail(group) {
  workspaceState.selectedGroupId = group.id;
  document.querySelector("#selectedGroupHeading").textContent = group.name;
  document.querySelector("#selectedGroupMeta").textContent = group.recipientsTruncated
    ? `顯示前 500 筆／共 ${group.recipientCount} 筆`
    : `共 ${group.recipientCount} 筆`;

  const body = document.querySelector("#recipientTableBody");
  body.replaceChildren();
  if (!group.recipients.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.textContent = "此群組尚無收件人。";
    row.append(cell);
    body.append(row);
  } else {
    for (const recipient of group.recipients) {
      const row = document.createElement("tr");
      for (const value of [
        recipient.displayName,
        recipient.email,
        recipient.businessUnit,
        recipient.department,
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value || "—";
        row.append(cell);
      }
      body.append(row);
    }
  }
  renderGroupList();
  document.querySelector("#csvGroupSelect").value = group.id;
}

async function loadGroupDetail(groupId) {
  const payload = await api(`/api/recipient-groups/${encodeURIComponent(groupId)}`);
  renderGroupDetail(payload.group);
}

async function loadGroups() {
  const payload = await api("/api/recipient-groups");
  workspaceState.groups = payload.groups;
  if (
    workspaceState.selectedGroupId &&
    !workspaceState.groups.some((group) => group.id === workspaceState.selectedGroupId)
  ) {
    workspaceState.selectedGroupId = null;
  }
  renderGroupList();
  if (!workspaceState.selectedGroupId && workspaceState.groups[0]) {
    await loadGroupDetail(workspaceState.groups[0].id);
  }
}

function renderTemplateList() {
  const list = document.querySelector("#templateList");
  list.replaceChildren();
  if (!workspaceState.templates.length) {
    list.append(emptyState("尚未建立範本。可匯入 EML 或建立手動 Draft。"));
    return;
  }
  for (const template of workspaceState.templates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "list-button";
    button.classList.toggle("active", template.id === workspaceState.selectedTemplateId);
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = template.name;
    const detail = document.createElement("small");
    detail.textContent = template.subject;
    copy.append(name, detail);
    const version = document.createElement("span");
    version.className = "list-meta";
    version.textContent = `v${template.latestVersion} · ${template.status}`;
    button.append(copy, version);
    button.addEventListener("click", () => selectTemplate(template.id));
    list.append(button);
  }
}

function renderSanitization(summary) {
  const labels = {
    externalLinksReplaced: "已替換外部連結",
    linksRemoved: "已移除其他連結",
    remoteImagesRemoved: "已移除遠端圖片",
    inlineImagesRemoved: "已移除內嵌圖片",
    dangerousElementsRemoved: "已移除主動元素",
    droppedHeaderCount: "未保存郵件標頭",
    acceptedAttachments: "通過附件 allowlist",
    quarantinedAttachments: "隔離附件",
  };
  const container = document.querySelector("#sanitizationSummary");
  container.replaceChildren();
  for (const [key, label] of Object.entries(labels)) {
    if (!(key in summary)) continue;
    const item = document.createElement("div");
    item.className = "summary-pair";
    item.textContent = label;
    const value = document.createElement("strong");
    value.textContent = String(summary[key]);
    item.append(value);
    container.append(item);
  }
}

function renderAttachments(attachments) {
  const list = document.querySelector("#attachmentList");
  list.replaceChildren();
  if (!attachments.length) {
    list.append(emptyState("目前版本沒有 MIME 附件。"));
    return;
  }
  for (const attachment of attachments) {
    const item = document.createElement("div");
    item.className = "attachment-item";
    item.classList.toggle("quarantined", attachment.storageStatus === "quarantined");
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = attachment.fileName;
    const detail = document.createElement("small");
    detail.className = "list-meta";
    detail.textContent = attachment.quarantineReason || `${attachment.mimeType} · ${attachment.sizeBytes} bytes`;
    copy.append(name, detail);
    const status = document.createElement("span");
    status.className = "attachment-state";
    status.textContent = attachment.storageStatus === "approved" ? "保留" : "隔離";
    item.append(copy, status);
    list.append(item);
  }
}

function renderTemplateDetail(template) {
  workspaceState.selectedTemplateId = template.id;
  workspaceState.selectedTemplate = template;
  document.querySelector("#templateDetailHeading").textContent = template.name;
  document.querySelector("#templateVersionBadge").textContent = `v${template.latestVersion} · ${template.status}`;
  document.querySelector("#templatePreview").src = `/api/templates/${encodeURIComponent(template.id)}/preview`;
  renderSanitization(template.sanitization);
  renderAttachments(template.attachments);

  const form = document.querySelector("#templateVersionForm");
  form.classList.toggle("hidden", !hasRole("system_admin", "campaign_creator"));
  form.elements.subject.value = template.subject;
  form.elements.htmlBody.value = template.htmlBody;
  form.elements.textBody.value = template.textBody;
  document.querySelector("#visualTemplateEditor").innerHTML = template.htmlBody;
  const reviewPanel = document.querySelector("#templateReviewPanel");
  reviewPanel.classList.remove("hidden");
  const pending = template.reviews?.find((review) => review.decision === "pending");
  document.querySelector("#templateReviewStatus").textContent = pending
    ? `待審核：${pending.requestedAt}`
    : `目前狀態：${template.status}。製作者與送審者不可自行核准。`;
  const role = workspaceState.currentUser?.role;
  document.querySelector("#submitTemplateReview").classList.toggle(
    "hidden",
    template.status !== "draft" || !["system_admin", "campaign_creator"].includes(role),
  );
  const canReview = Boolean(pending) && ["system_admin", "reviewer"].includes(role);
  document.querySelector("#approveTemplateReview").classList.toggle("hidden", !canReview);
  document.querySelector("#rejectTemplateReview").classList.toggle("hidden", !canReview);
  renderTemplateList();
}

async function selectTemplate(templateId) {
  const payload = await api(`/api/templates/${encodeURIComponent(templateId)}`);
  renderTemplateDetail(payload.template);
}

async function loadTemplates() {
  const payload = await api("/api/templates");
  workspaceState.templates = payload.templates;
  if (
    workspaceState.selectedTemplateId &&
    !workspaceState.templates.some((template) => template.id === workspaceState.selectedTemplateId)
  ) {
    workspaceState.selectedTemplateId = null;
  }
  renderTemplateList();
  if (!workspaceState.selectedTemplateId && workspaceState.templates[0]) {
    await selectTemplate(workspaceState.templates[0].id);
  }
}

function renderDashboard(payload) {
  workspaceState.currentUser = payload.user;
  if (payload.passwordChangeRequired) {
    showView("password");
    return;
  }
  document.querySelector("#organizationHeading").textContent = payload.settings.organization.name;
  document.querySelector("#currentUser").textContent = payload.user.displayName;
  document.querySelector("#currentRole").textContent = payload.user.role;
  fillSettings(payload.settings);
  const allowedWorkspaces = {
    system_admin: new Set(["overview", "audiences", "templates", "campaigns", "reports", "operations"]),
    campaign_creator: new Set(["overview", "audiences", "templates", "campaigns", "reports"]),
    reviewer: new Set(["overview", "templates", "campaigns", "reports"]),
    report_viewer: new Set(["overview", "campaigns", "reports"]),
  }[payload.user.role] ?? new Set(["overview"]);
  for (const tab of document.querySelectorAll("[data-workspace-target]")) {
    tab.classList.toggle("hidden", !allowedWorkspaces.has(tab.dataset.workspaceTarget));
  }
  document.querySelector("#settingsPanel").classList.toggle("hidden", !hasRole("system_admin"));
  for (const section of document.querySelectorAll("[data-manage-templates]")) {
    section.classList.toggle("hidden", !hasRole("system_admin", "campaign_creator"));
  }
  document.querySelector("#connectorPanel").classList.toggle("hidden", !hasRole("system_admin"));
  document.querySelector("#campaignBuilderPanel").classList.toggle("hidden", !canManageCampaigns());
  document.querySelector("#vendorReportPanel").classList.toggle("hidden", !canGenerateReports());
  renderReadiness(payload.readiness);
  document.querySelector("#currentPhaseMetric").textContent = `${payload.readiness.currentPhase} / 5`;
  showView("dashboard");
  activateWorkspace("overview");
  void refreshDeliveryState();
}

async function refreshDeliveryState() {
  try {
    const health = await api("/api/health");
    const ready = health.mailSendingEnabled;
    document.querySelector("#mailMetric").textContent = health.emergencyStop
      ? "緊急停止"
      : ready
        ? "可排程"
        : "未就緒";
    document.querySelector("#deliveryStateTitle").textContent = health.emergencyStop
      ? "緊急停止已啟用"
      : ready
        ? "連接器已驗證"
        : "寄信尚未就緒";
    document.querySelector("#deliveryStateDetail").textContent = ready
      ? "仍須範本與活動雙人核准"
      : "請先建立並驗證 pickup 或 SMTP 連接器";
  } catch {
    document.querySelector("#mailMetric").textContent = "未知";
  }
}

for (const tab of document.querySelectorAll("[data-workspace-target]")) {
  tab.addEventListener("click", async () => {
    try {
      await activateWorkspace(tab.dataset.workspaceTarget);
    } catch (error) {
      showToast(error.message);
    }
  });
}

document.querySelector("#groupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  setFormState(form, true);
  try {
    const payload = await api("/api/recipient-groups", {
      method: "POST",
      body: JSON.stringify({ name: data.get("name"), description: data.get("description") }),
    });
    form.reset();
    setFormState(form, false);
    workspaceState.selectedGroupId = payload.group.id;
    await loadGroups();
    await loadGroupDetail(payload.group.id);
    showToast("名單群組已建立。");
  } catch (error) {
    setFormState(form, false, error.message);
  }
});

document.querySelector("#rosterImportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const groupId = String(data.get("groupId") ?? "");
  const file = form.elements.rosterFile.files[0];
  if (!groupId || !file) {
    setFormState(form, false, "請選擇群組與 CSV／XLSX 檔案。");
    return;
  }
  const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
  if (file.size > (isXlsx ? 5 : 1) * 1024 * 1024) {
    setFormState(form, false, `${isXlsx ? "XLSX" : "CSV"} 超過大小上限。`);
    return;
  }

  setFormState(form, true);
  try {
    const payload = isXlsx
      ? await api(`/api/recipient-groups/${encodeURIComponent(groupId)}/import-xlsx`, {
          method: "POST",
          headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
          body: file,
        })
      : await api(`/api/recipient-groups/${encodeURIComponent(groupId)}/import-csv`, {
          method: "POST",
          body: JSON.stringify({ csvText: await file.text() }),
        });
    const summary = document.querySelector("#importResult");
    const layoutText = payload.layout === "headerless_department_name_email_unit"
      ? "已辨識無標題格式（A 部門、B 姓名、C Email、D 部群／廠區）"
      : "已辨識標題欄位格式";
    summary.textContent = `${layoutText}。共 ${payload.totalRows} 筆；接受 ${payload.acceptedRows} 筆、略過 ${payload.skippedRows} 筆、檔內重複 ${payload.duplicateRows} 筆。新增群組成員 ${payload.addedMemberships} 筆。`;
    summary.classList.remove("hidden");
    form.elements.rosterFile.value = "";
    setFormState(form, false);
    workspaceState.selectedGroupId = groupId;
    await loadGroups();
    await loadGroupDetail(groupId);
  } catch (error) {
    setFormState(form, false, error.message);
  }
});

document.querySelector("#templateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  setFormState(form, true);
  try {
    const payload = await api("/api/templates", {
      method: "POST",
      body: JSON.stringify({
        name: data.get("name"),
        subject: data.get("subject"),
        htmlBody: data.get("htmlBody"),
        textBody: data.get("textBody"),
      }),
    });
    form.reset();
    setFormState(form, false);
    workspaceState.selectedTemplateId = payload.template.id;
    await loadTemplates();
    await selectTemplate(payload.template.id);
    showToast("範本 Draft 已建立並完成安全清理。");
  } catch (error) {
    setFormState(form, false, error.message);
  }
});

document.querySelector("#emlImportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.elements.emlFile.files[0];
  if (!file) {
    setFormState(form, false, "請選擇 EML 檔案。");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    setFormState(form, false, "EML 超過 10 MB 上限。");
    return;
  }

  setFormState(form, true);
  try {
    const payload = await api(`/api/templates/import-eml?fileName=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "message/rfc822" },
      body: file,
    });
    form.reset();
    setFormState(form, false);
    workspaceState.selectedTemplateId = payload.template.id;
    await loadTemplates();
    await selectTemplate(payload.template.id);
    showToast("EML 已隔離清理；外部資源不會載入。");
  } catch (error) {
    setFormState(form, false, error.message);
  }
});

document.querySelector("#templateVersionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!workspaceState.selectedTemplateId) {
    setFormState(form, false, "請先選擇範本。");
    return;
  }
  form.elements.htmlBody.value = document.querySelector("#visualTemplateEditor").innerHTML;
  const data = new FormData(form);
  setFormState(form, true);
  try {
    const payload = await api(
      `/api/templates/${encodeURIComponent(workspaceState.selectedTemplateId)}/versions`,
      {
        method: "POST",
        body: JSON.stringify({
          subject: data.get("subject"),
          htmlBody: data.get("htmlBody"),
          textBody: data.get("textBody"),
        }),
      },
    );
    setFormState(form, false);
    await loadTemplates();
    renderTemplateDetail(payload.template);
    showToast(`已建立範本 v${payload.template.latestVersion}。`);
  } catch (error) {
    setFormState(form, false, error.message);
  }
});

for (const button of document.querySelectorAll("[data-editor-command]")) {
  button.addEventListener("click", () => {
    document.querySelector("#visualTemplateEditor").focus();
    document.execCommand(button.dataset.editorCommand, false);
  });
}

for (const button of document.querySelectorAll("[data-editor-placeholder]")) {
  button.addEventListener("click", () => {
    document.querySelector("#visualTemplateEditor").focus();
    document.execCommand("insertText", false, button.dataset.editorPlaceholder);
  });
}

document.querySelector("#submitTemplateReview").addEventListener("click", async () => {
  if (!workspaceState.selectedTemplateId) return;
  try {
    const payload = await api(`/api/templates/${encodeURIComponent(workspaceState.selectedTemplateId)}/review-requests`, {
      method: "POST",
      body: JSON.stringify({ comment: document.querySelector("#templateReviewComment").value }),
    });
    renderTemplateDetail(payload.template);
    await loadTemplates();
    showToast("範本已送交獨立審核。");
  } catch (error) {
    showToast(error.message);
  }
});

async function decideTemplateReview(decision) {
  const template = workspaceState.selectedTemplate;
  const review = template?.reviews?.find((item) => item.decision === "pending");
  if (!template || !review) return;
  try {
    const payload = await api(`/api/templates/${encodeURIComponent(template.id)}/reviews/${encodeURIComponent(review.id)}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, comment: document.querySelector("#templateReviewComment").value }),
    });
    renderTemplateDetail(payload.template);
    await loadTemplates();
    showToast(decision === "approved" ? "範本已核准。" : "範本已退回 Draft。");
  } catch (error) {
    showToast(error.message);
  }
}

document.querySelector("#approveTemplateReview").addEventListener("click", () => decideTemplateReview("approved"));
document.querySelector("#rejectTemplateReview").addEventListener("click", () => decideTemplateReview("rejected"));

function fillSelect(select, items, label, emptyLabel) {
  select.replaceChildren();
  if (!items.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    select.append(option);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = label(item);
    select.append(option);
  }
}

function renderConnectors() {
  const list = document.querySelector("#connectorList");
  list.replaceChildren();
  if (!workspaceState.connectors.length) list.append(emptyState("尚未建立郵件連接器。"));
  for (const connector of workspaceState.connectors) {
    const item = document.createElement("div");
    item.className = "list-button static";
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = connector.name;
    const detail = document.createElement("small");
    detail.textContent = `${connector.connectorType} · ${connector.senderEmail}`;
    copy.append(name, detail);
    const status = document.createElement("span");
    status.className = "list-meta";
    status.textContent = connector.status;
    item.append(copy, status);
    list.append(item);
  }
  fillSelect(
    document.querySelector("#connectorVerifySelect"),
    workspaceState.connectors.filter((item) => item.status !== "disabled"),
    (item) => `${item.name} · ${item.status}`,
    "請先建立連接器",
  );
  fillSelect(
    document.querySelector("#campaignConnectorSelect"),
    workspaceState.connectors.filter((item) => item.status === "ready"),
    (item) => item.name,
    "尚無已驗證連接器",
  );
}

function renderCampaignList() {
  const list = document.querySelector("#campaignList");
  list.replaceChildren();
  if (!workspaceState.campaigns.length) {
    list.append(emptyState("尚未建立活動。需要已核准範本與已驗證連接器。"));
    return;
  }
  for (const campaign of workspaceState.campaigns) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "list-button";
    button.classList.toggle("active", campaign.id === workspaceState.selectedCampaignId);
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = campaign.name;
    const detail = document.createElement("small");
    detail.textContent = `${campaign.templateName} · ${campaign.recipientGroupName}`;
    copy.append(name, detail);
    const status = document.createElement("span");
    status.className = "list-meta";
    status.textContent = `${campaign.status} · ${campaign.sentCount}/${campaign.targetCount}`;
    button.append(copy, status);
    button.addEventListener("click", () => selectCampaign(campaign.id));
    list.append(button);
  }
}

function renderCampaignDetail(campaign) {
  workspaceState.selectedCampaignId = campaign.id;
  workspaceState.selectedCampaign = campaign;
  document.querySelector("#campaignDetail").classList.remove("hidden");
  document.querySelector("#campaignDetailHeading").textContent = campaign.name;
  document.querySelector("#campaignStatus").textContent = campaign.status;
  const metrics = document.querySelector("#campaignMetrics");
  metrics.replaceChildren();
  for (const [label, value] of [
    ["目標", campaign.metrics.targetCount],
    ["寄送端已接受", campaign.metrics.sentAcceptedCount],
    ["實際投遞", campaign.metrics.deliveredCount ?? "未取得 DSN"],
    ["開啟", campaign.metrics.uniqueOpened],
    ["點閱", campaign.metrics.uniqueClicked],
    ["附件開啟", campaign.metrics.uniqueAttachmentOpened],
    ["完成提醒", campaign.metrics.uniqueTrainingAcknowledged],
  ]) {
    const card = document.createElement("div");
    card.className = "summary-pair";
    card.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = String(value);
    card.append(strong);
    metrics.append(card);
  }
  const pending = campaign.reviews?.find((review) => review.decision === "pending");
  const approved = campaign.reviews?.find((review) => review.decision === "approved");
  const review = pending ?? approved;
  document.querySelector("#campaignApprovalSummary").textContent = review
    ? `覆核快照：${review.recipientCount} 人；digest ${review.approvalDigest?.slice(0, 16) ?? "尚未建立"}…｜追蹤 ${campaign.baseUrl}｜${campaign.testOnly ? "僅測試信箱" : "正式核准範圍"}｜時窗 ${campaign.sendWindowStart}–${campaign.sendWindowEnd}｜每分鐘 ${campaign.throttlePerMinute} 封｜連接器 ${campaign.connectorName}`
    : `尚未建立覆核快照｜追蹤 ${campaign.baseUrl}｜${campaign.testOnly ? "僅測試信箱" : "正式核准範圍"}｜連接器 ${campaign.connectorName}`;
  const role = workspaceState.currentUser?.role;
  document.querySelector("#submitCampaignReview").classList.toggle("hidden", campaign.status !== "draft" || !["system_admin", "campaign_creator"].includes(role));
  const canReview = Boolean(pending) && ["system_admin", "reviewer"].includes(role);
  document.querySelector("#approveCampaignReview").classList.toggle("hidden", !canReview);
  document.querySelector("#rejectCampaignReview").classList.toggle("hidden", !canReview);
  document.querySelector("#scheduleCampaign").classList.toggle("hidden", campaign.status !== "approved" || !canManageCampaigns());
  document.querySelector("#processQueue").classList.toggle("hidden", !hasRole("system_admin"));
  document.querySelector("#pauseCampaign").classList.toggle("hidden", !hasRole("system_admin") || !["scheduled", "running", "paused"].includes(campaign.status));
  document.querySelector("#pauseCampaign").textContent = campaign.status === "paused" ? "繼續" : "暫停";
  document.querySelector("#cancelCampaign").classList.toggle("hidden", !hasRole("system_admin") || ["completed", "cancelled"].includes(campaign.status));
  document.querySelector("#generateCampaignReport").classList.toggle("hidden", !canGenerateReports());
  document.querySelector("#evidenceImportForm").classList.toggle("hidden", !hasRole("system_admin"));
  renderCampaignList();
}

async function selectCampaign(campaignId) {
  const payload = await api(`/api/campaigns/${encodeURIComponent(campaignId)}`);
  renderCampaignDetail(payload.campaign);
}

async function loadCampaignWorkspace() {
  const campaigns = await api("/api/campaigns");
  workspaceState.campaigns = campaigns.campaigns;
  if (canManageCampaigns()) {
    const [connectors, templates, groups] = await Promise.all([
      api("/api/connectors"),
      api("/api/templates"),
      api("/api/recipient-groups"),
    ]);
    workspaceState.connectors = connectors.connectors;
    workspaceState.templates = templates.templates;
    workspaceState.groups = groups.groups;
    renderConnectors();
    fillSelect(document.querySelector("#campaignTemplateSelect"), workspaceState.templates.filter((item) => item.status === "approved"), (item) => item.name, "尚無已核准範本");
    fillSelect(document.querySelector("#campaignGroupSelect"), workspaceState.groups.filter((item) => item.recipientCount > 0), (item) => `${item.name}（${item.recipientCount}）`, "尚無有成員的群組");
  }
  renderCampaignList();
  if (workspaceState.selectedCampaignId && workspaceState.campaigns.some((item) => item.id === workspaceState.selectedCampaignId)) {
    await selectCampaign(workspaceState.selectedCampaignId);
  }
}

document.querySelector("#connectorForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const connectorType = String(data.get("connectorType"));
  const body = {
    name: data.get("name"),
    connectorType,
    senderName: data.get("senderName"),
    senderEmail: data.get("senderEmail"),
  };
  if (connectorType === "smtp") {
    Object.assign(body, {
      host: data.get("host"),
      port: Number(data.get("port")),
      secure: data.get("secure") === "on",
      username: data.get("username"),
      password: data.get("password"),
    });
  }
  setFormState(form, true);
  try {
    await api("/api/connectors", { method: "POST", body: JSON.stringify(body) });
    form.reset();
    form.elements.port.value = 587;
    setFormState(form, false);
    await loadCampaignWorkspace();
    showToast("連接器 Draft 已建立，請以 allowlist 測試信箱驗證。");
  } catch (error) {
    setFormState(form, false, error.message);
  }
});

document.querySelector("#connectorVerifyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  setFormState(form, true);
  try {
    await api(`/api/connectors/${encodeURIComponent(String(data.get("connectorId")))}/verify`, {
      method: "POST",
      body: JSON.stringify({ testRecipientEmail: data.get("testRecipientEmail") }),
    });
    setFormState(form, false);
    await loadCampaignWorkspace();
    await refreshDeliveryState();
    showToast("連接器驗證完成；測試信已送至 pickup 或指定測試信箱。");
  } catch (error) {
    setFormState(form, false, error.message);
  }
});

document.querySelector("#campaignForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  setFormState(form, true);
  try {
    const payload = await api("/api/campaigns", {
      method: "POST",
      body: JSON.stringify({
        name: data.get("name"),
        templateId: data.get("templateId"),
        recipientGroupId: data.get("recipientGroupId"),
        connectorId: data.get("connectorId"),
        baseUrl: data.get("baseUrl"),
        sendWindowStart: data.get("sendWindowStart"),
        sendWindowEnd: data.get("sendWindowEnd"),
        throttlePerMinute: Number(data.get("throttlePerMinute")),
        testOnly: data.get("testOnly") === "on",
      }),
    });
    workspaceState.selectedCampaignId = payload.campaign.id;
    setFormState(form, false);
    await loadCampaignWorkspace();
    await selectCampaign(payload.campaign.id);
    showToast("活動 Draft 已建立，尚未排程或寄送。");
  } catch (error) {
    setFormState(form, false, error.message);
  }
});

document.querySelector("#submitCampaignReview").addEventListener("click", async () => {
  if (!workspaceState.selectedCampaignId) return;
  try {
    const payload = await api(`/api/campaigns/${encodeURIComponent(workspaceState.selectedCampaignId)}/review-requests`, {
      method: "POST",
      body: JSON.stringify({ comment: document.querySelector("#campaignReviewComment").value }),
    });
    renderCampaignDetail(payload.campaign);
    showToast("活動已送交獨立審核。");
  } catch (error) { showToast(error.message); }
});

async function decideCampaignReview(decision) {
  const campaign = workspaceState.selectedCampaign;
  const review = campaign?.reviews?.find((item) => item.decision === "pending");
  if (!campaign || !review) return;
  try {
    const payload = await api(`/api/campaigns/${encodeURIComponent(campaign.id)}/reviews/${encodeURIComponent(review.id)}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, comment: document.querySelector("#campaignReviewComment").value }),
    });
    renderCampaignDetail(payload.campaign);
    await loadCampaignWorkspace();
    showToast(decision === "approved" ? "活動已核准，可排程。" : "活動已退回 Draft。");
  } catch (error) { showToast(error.message); }
}

document.querySelector("#approveCampaignReview").addEventListener("click", () => decideCampaignReview("approved"));
document.querySelector("#rejectCampaignReview").addEventListener("click", () => decideCampaignReview("rejected"));

document.querySelector("#scheduleCampaign").addEventListener("click", async () => {
  if (!workspaceState.selectedCampaignId) return;
  try {
    const payload = await api(`/api/campaigns/${encodeURIComponent(workspaceState.selectedCampaignId)}/schedule`, { method: "POST", body: "{}" });
    renderCampaignDetail(payload.campaign);
    await loadCampaignWorkspace();
    showToast("活動已排程；worker 會依時窗與節流處理。");
  } catch (error) { showToast(error.message); }
});

document.querySelector("#processQueue").addEventListener("click", async () => {
  try {
    const result = await api("/api/delivery/process", { method: "POST" });
    await loadCampaignWorkspace();
    showToast(`佇列處理完成：寄送 ${result.sent}、失敗 ${result.failed}。`);
  } catch (error) { showToast(error.message); }
});

async function operateCampaign(operation) {
  if (!workspaceState.selectedCampaignId) return;
  try {
    const payload = await api(`/api/campaigns/${encodeURIComponent(workspaceState.selectedCampaignId)}/operation`, {
      method: "POST",
      body: JSON.stringify({ operation }),
    });
    renderCampaignDetail(payload.campaign);
    await loadCampaignWorkspace();
  } catch (error) { showToast(error.message); }
}

document.querySelector("#pauseCampaign").addEventListener("click", () => operateCampaign(workspaceState.selectedCampaign?.status === "paused" ? "resume" : "pause"));
document.querySelector("#cancelCampaign").addEventListener("click", () => operateCampaign("cancel"));

function renderArtifacts(payload) {
  const list = document.querySelector("#artifactList");
  list.replaceChildren();
  for (const artifact of payload.artifacts) {
    const link = document.createElement("a");
    link.className = "artifact-item";
    link.href = `/api/report-artifacts/${encodeURIComponent(artifact.id)}/download`;
    link.textContent = `${artifact.format.toUpperCase()} · ${artifact.fileName} · ${artifact.sizeBytes} bytes`;
    list.append(link);
  }
  const warnings = document.querySelector("#reportWarnings");
  warnings.textContent = payload.analysis.warnings.join("；") || "報表已產生，未發現額外資料品質警示。";
  warnings.classList.remove("hidden");
  activateWorkspace("reports");
}

async function loadReports() {
  const payload = await api("/api/report-artifacts");
  const list = document.querySelector("#artifactList");
  list.replaceChildren();
  if (!payload.artifacts.length) {
    list.append(emptyState("尚未產生報表。報表產生權限與檢視權限分開控管。"));
    return;
  }
  for (const artifact of payload.artifacts) {
    const link = document.createElement("a");
    link.className = "artifact-item";
    link.href = `/api/report-artifacts/${encodeURIComponent(artifact.id)}/download`;
    link.textContent = `${artifact.format.toUpperCase()} · ${artifact.fileName} · ${artifact.sizeBytes} bytes · ${new Date(artifact.createdAt).toLocaleString()}`;
    list.append(link);
  }
}

document.querySelector("#generateCampaignReport").addEventListener("click", async () => {
  if (!workspaceState.selectedCampaignId) return;
  try {
    const payload = await api(`/api/campaigns/${encodeURIComponent(workspaceState.selectedCampaignId)}/reports`, { method: "POST" });
    renderArtifacts(payload);
    showToast("Excel、Word 與 JSON 報表已完成。");
  } catch (error) { showToast(error.message); }
});

document.querySelector("#evidenceImportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!workspaceState.selectedCampaignId) return;
  const data = new FormData(form);
  let events;
  try {
    events = JSON.parse(String(data.get("events") ?? ""));
    if (!Array.isArray(events)) throw new Error();
  } catch {
    setFormState(form, false, "事件內容必須是 JSON 陣列。");
    return;
  }
  setFormState(form, true);
  try {
    const payload = await api(`/api/campaigns/${encodeURIComponent(workspaceState.selectedCampaignId)}/audit-events`, {
      method: "POST",
      body: JSON.stringify({
        sourceReference: data.get("sourceReference"),
        sourceDigest: data.get("sourceDigest"),
        events,
      }),
    });
    setFormState(form, false, `已匯入 ${payload.imported} 筆；略過 ${payload.skipped} 筆。`);
    await selectCampaign(workspaceState.selectedCampaignId);
  } catch (error) {
    setFormState(form, false, error.message);
  }
});

document.querySelector("#vendorReportForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const file = form.elements.rawdataFile.files[0];
  if (!file) return setFormState(form, false, "請選擇 rawdata XLSX。");
  const query = new URLSearchParams({ fileName: file.name, campaignName: String(data.get("campaignName") ?? "") });
  if (data.get("targetCount")) query.set("targetCount", String(data.get("targetCount")));
  setFormState(form, true);
  try {
    const payload = await api(`/api/reports/vendor-rawdata?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      body: file,
    });
    setFormState(form, false);
    renderArtifacts(payload);
  } catch (error) { setFormState(form, false, error.message); }
});

function renderUsers() {
  const list = document.querySelector("#userList");
  list.replaceChildren();
  for (const user of workspaceState.users) {
    const item = document.createElement("div");
    item.className = "list-button static";
    const name = document.createElement("strong");
    name.textContent = `${user.displayName}（${user.username}）`;
    const controls = document.createElement("div");
    controls.className = "user-controls";
    const role = document.createElement("select");
    for (const [value, label] of [["campaign_creator", "活動建立者"], ["reviewer", "獨立審核者"], ["report_viewer", "報表檢視者"], ["system_admin", "系統管理員"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = user.role === value;
      role.append(option);
    }
    const status = document.createElement("select");
    for (const [value, label] of [["active", "啟用"], ["disabled", "停用"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = user.status === value;
      status.append(option);
    }
    const save = document.createElement("button");
    save.type = "button";
    save.className = "button";
    save.textContent = "儲存權限";
    save.addEventListener("click", async () => {
      try {
        await api(`/api/users/${encodeURIComponent(user.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ role: role.value, status: status.value }),
        });
        await loadOperations();
        showToast("帳號權限已更新，既有工作階段已撤銷。");
      } catch (error) { showToast(error.message); }
    });
    const revoke = document.createElement("button");
    revoke.type = "button";
    revoke.className = "button";
    revoke.textContent = "撤銷登入";
    revoke.addEventListener("click", async () => {
      try {
        const payload = await api(`/api/users/${encodeURIComponent(user.id)}/revoke-sessions`, { method: "POST" });
        showToast(`已撤銷 ${payload.revoked} 個工作階段。`);
      } catch (error) { showToast(error.message); }
    });
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "button danger";
    reset.textContent = "重設密碼";
    reset.addEventListener("click", async () => {
      const password = window.prompt(`輸入 ${user.username} 的新初始密碼（至少 12 字元）：`);
      if (!password) return;
      try {
        await api(`/api/users/${encodeURIComponent(user.id)}/reset-password`, {
          method: "POST",
          body: JSON.stringify({ password }),
        });
        await loadOperations();
        showToast("密碼已重設；該使用者下次登入必須變更密碼。");
      } catch (error) { showToast(error.message); }
    });
    const state = document.createElement("small");
    state.className = "list-meta";
    state.textContent = `${user.status} · ${user.mustChangePassword ? "需換密碼" : "密碼已啟用"}`;
    controls.append(role, status, save, revoke, reset, state);
    item.append(name, controls);
    list.append(item);
  }
}

async function loadOperations() {
  const [users, control] = await Promise.all([api("/api/users"), api("/api/delivery/control")]);
  workspaceState.users = users.users;
  renderUsers();
  document.querySelector("#emergencyState").textContent = control.emergencyStop ? "緊急停止：已啟用，worker 不會寄出新郵件。" : "緊急停止：未啟用。";
}

document.querySelector("#userForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  setFormState(form, true);
  try {
    await api("/api/users", { method: "POST", body: JSON.stringify(Object.fromEntries(data)) });
    form.reset();
    setFormState(form, false);
    await loadOperations();
    showToast("使用者已建立；請由不同帳號完成覆核。");
  } catch (error) { setFormState(form, false, error.message); }
});

async function setEmergencyStop(emergencyStop) {
  try {
    await api("/api/delivery/control", { method: "PUT", body: JSON.stringify({ emergencyStop }) });
    await loadOperations();
    await refreshDeliveryState();
    showToast(emergencyStop ? "緊急停止已啟用。" : "緊急停止已解除。");
  } catch (error) { showToast(error.message); }
}

document.querySelector("#enableEmergencyStop").addEventListener("click", () => setEmergencyStop(true));
document.querySelector("#disableEmergencyStop").addEventListener("click", () => setEmergencyStop(false));

document.querySelector("#suppressionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  setFormState(form, true);
  try {
    await api("/api/suppressions", {
      method: "POST",
      body: JSON.stringify({ email: data.get("email"), reason: data.get("reason") }),
    });
    form.reset();
    setFormState(form, false);
    showToast("已加入抑制清單，尚未寄送的目標會被停止。");
  } catch (error) { setFormState(form, false, error.message); }
});

document.querySelector("#setupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  if (data.get("password") !== data.get("passwordConfirmation")) {
    setFormState(form, false, "兩次輸入的密碼不一致。");
    return;
  }
  setFormState(form, true);
  try {
    const payload = await api("/api/setup", {
      method: "POST",
      headers: { "X-Bootstrap-Token": String(data.get("bootstrapToken") ?? "") },
      body: JSON.stringify({
        organizationName: data.get("organizationName"),
        displayName: data.get("displayName"),
        username: data.get("username"),
        password: data.get("password"),
      }),
    });
    renderDashboard(payload);
    showToast("第一階段初始化完成。");
  } catch (error) {
    setFormState(form, false, error.message);
  }
});

document.querySelector("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  setFormState(form, true);
  try {
    const payload = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
    });
    form.reset();
    setFormState(form, false);
    renderDashboard(payload);
  } catch (error) {
    setFormState(form, false, error.message);
  }
});

document.querySelector("#passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  if (data.get("newPassword") !== data.get("newPasswordConfirmation")) {
    setFormState(form, false, "兩次輸入的新密碼不一致。");
    return;
  }
  setFormState(form, true);
  try {
    await api("/api/auth/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: data.get("currentPassword"),
        newPassword: data.get("newPassword"),
      }),
    });
    form.reset();
    setFormState(form, false);
    showView("login");
    showToast("密碼已更新，請使用新密碼重新登入。");
  } catch (error) {
    setFormState(form, false, error.message);
  }
});

document.querySelector("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  setFormState(form, true);
  try {
    const payload = await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        organizationName: data.get("organizationName"),
        timezone: data.get("timezone"),
        retentionDays: Number(data.get("retentionDays")),
        recipientDomains: lines(String(data.get("recipientDomains") ?? "")),
        senderDomains: lines(String(data.get("senderDomains") ?? "")),
        testRecipientEmails: lines(String(data.get("testRecipientEmails") ?? "")),
      }),
    });
    fillSettings(payload.settings);
    renderReadiness(payload.readiness);
    document.querySelector("#organizationHeading").textContent = payload.settings.organization.name;
    setFormState(form, false);
    showToast("範圍設定已儲存；既有活動會在排程與寄送前重新驗證範圍。");
  } catch (error) {
    setFormState(form, false, error.message);
  }
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // Cookie 仍會在重新載入時由伺服器驗證；不在畫面揭露內部錯誤。
  } finally {
    logoutButton.disabled = false;
    workspaceState.groups = [];
    workspaceState.templates = [];
    workspaceState.connectors = [];
    workspaceState.campaigns = [];
    workspaceState.users = [];
    workspaceState.selectedGroupId = null;
    workspaceState.selectedTemplateId = null;
    workspaceState.selectedTemplate = null;
    workspaceState.selectedCampaignId = null;
    workspaceState.selectedCampaign = null;
    workspaceState.currentUser = null;
    document.querySelector("#templatePreview").removeAttribute("src");
    showView("login");
  }
});

async function bootstrap() {
  try {
    const payload = await api("/api/bootstrap");
    if (payload.setupRequired) showView("setup");
    else if (!payload.authenticated) showView("login");
    else renderDashboard(payload);
  } catch (error) {
    const loading = document.querySelector("#loadingView p");
    loading.textContent = `無法載入平台：${error.message}`;
  }
}

bootstrap();

import crypto from "node:crypto";
import {
  applySettingsUpdate,
  buildReadiness,
  createInitialSettings,
  SettingsValidationError,
  type PlatformReadiness,
  type PlatformSettings,
} from "../domain/settings.js";
import {
  createOpaqueToken,
  hashPassword,
  hashToken,
  tokensMatch,
  validatePassword,
  verifyPassword,
} from "../domain/security.js";
import { roleHasPermission, type Permission } from "../domain/authorization.js";
import {
  PlatformAlreadyInitializedError,
  PlatformStore,
  UserAlreadyExistsError,
  type AccessRole,
  type StoredSession,
  type StoredUser,
} from "../infrastructure/platform-store.js";

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: AccessRole;
  status: "active" | "disabled";
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export interface SessionContext {
  sessionHash: string;
  csrfHash: string;
  expiresAt: string;
  user: PublicUser;
}

export interface NewSessionResult {
  sessionToken: string;
  csrfToken: string;
  expiresAt: string;
  user: PublicUser;
}

function recordFrom(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "INVALID_INPUT", "輸入格式不正確。");
  }
  return value as Record<string, unknown>;
}

function requiredText(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string") throw new AppError(400, "INVALID_INPUT", `${label}格式不正確。`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new AppError(
      400,
      "INVALID_INPUT",
      `${label}長度必須介於 ${minimum} 到 ${maximum} 個字元。`,
    );
  }
  return normalized;
}

function publicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
  };
}

function changedSettingFields(before: PlatformSettings, after: PlatformSettings): string[] {
  const fields: string[] = [];
  if (before.organization.name !== after.organization.name) fields.push("organizationName");
  if (before.organization.timezone !== after.organization.timezone) fields.push("timezone");
  if (before.organization.retentionDays !== after.organization.retentionDays) fields.push("retentionDays");
  if (JSON.stringify(before.scope.recipientDomains) !== JSON.stringify(after.scope.recipientDomains)) {
    fields.push("recipientDomains");
  }
  if (JSON.stringify(before.scope.senderDomains) !== JSON.stringify(after.scope.senderDomains)) {
    fields.push("senderDomains");
  }
  if (
    JSON.stringify(before.scope.testRecipientEmails) !==
    JSON.stringify(after.scope.testRecipientEmails)
  ) {
    fields.push("testRecipientEmails");
  }
  return fields;
}

export class PlatformService {
  private readonly dummyPasswordHash = hashPassword(
    "Local-Awareness-Dummy-Verification-2026!",
  );

  constructor(
    private readonly store: PlatformStore,
    private readonly sessionTtlMs: number,
  ) {}

  setupRequired(): boolean {
    return this.store.isSetupRequired();
  }

  async initialize(input: unknown): Promise<NewSessionResult> {
    if (!this.store.isSetupRequired()) {
      throw new AppError(409, "ALREADY_INITIALIZED", "平台已完成初始化，不能再次建立首位管理員。");
    }
    const record = recordFrom(input);
    const username = requiredText(record.username, "管理員帳號", 3, 80);
    if (!/^[\p{L}\p{N}._@-]+$/u.test(username)) {
      throw new AppError(400, "INVALID_INPUT", "管理員帳號只能包含文字、數字、點、底線、@ 或連字號。");
    }
    const displayName = requiredText(record.displayName, "顯示名稱", 2, 80);
    const organizationName = requiredText(record.organizationName, "組織名稱", 2, 120);

    let password: string;
    try {
      password = validatePassword(record.password, username);
    } catch (error) {
      throw new AppError(400, "INVALID_PASSWORD", (error as Error).message);
    }

    const now = new Date().toISOString();
    const user: StoredUser = {
      id: crypto.randomUUID(),
      username,
      usernameNormalized: username.toLowerCase(),
      displayName,
      passwordHash: await hashPassword(password),
      role: "system_admin",
      status: "active",
      mustChangePassword: false,
      createdAt: now,
      lastLoginAt: null,
    };

    try {
      this.store.initializePlatform({
        user,
        settings: createInitialSettings(organizationName),
        occurredAt: now,
      });
    } catch (error) {
      if (error instanceof PlatformAlreadyInitializedError) {
        throw new AppError(409, "ALREADY_INITIALIZED", "平台已完成初始化。");
      }
      throw error;
    }
    return this.createSession(user, now);
  }

  async login(input: unknown): Promise<NewSessionResult> {
    if (this.store.isSetupRequired()) {
      throw new AppError(409, "SETUP_REQUIRED", "請先完成平台初始化。");
    }
    const record = recordFrom(input);
    const username = requiredText(record.username, "管理員帳號", 3, 80);
    if (typeof record.password !== "string") {
      throw new AppError(401, "INVALID_CREDENTIALS", "帳號或密碼不正確。");
    }

    const user = this.store.findUserByNormalizedUsername(username.toLowerCase());
    const passwordHash = user?.passwordHash ?? (await this.dummyPasswordHash);
    const passwordMatches = await verifyPassword(record.password, passwordHash);
    if (!user || !passwordMatches) {
      this.store.appendAudit(new Date().toISOString(), null, "auth.login_failed", "user", null, {});
      throw new AppError(401, "INVALID_CREDENTIALS", "帳號或密碼不正確。");
    }

    const now = new Date().toISOString();
    this.store.recordSuccessfulLogin(user.id, now);
    return this.createSession({ ...user, lastLoginAt: now }, now);
  }

  authenticate(sessionToken: string | null): SessionContext {
    if (!sessionToken) throw new AppError(401, "AUTH_REQUIRED", "請先登入。");
    const session = this.store.findSession(hashToken(sessionToken), new Date().toISOString());
    if (!session) throw new AppError(401, "SESSION_EXPIRED", "登入狀態已失效，請重新登入。");
    return this.publicSession(session);
  }

  verifyCsrf(session: SessionContext, headerToken: string | null, cookieToken: string | null): void {
    if (!headerToken || !cookieToken || !tokensMatch(headerToken, cookieToken)) {
      throw new AppError(403, "CSRF_REJECTED", "請求驗證失敗，請重新整理頁面後再試。");
    }
    if (!tokensMatch(hashToken(headerToken), session.csrfHash)) {
      throw new AppError(403, "CSRF_REJECTED", "請求驗證失敗，請重新登入。");
    }
  }

  logout(session: SessionContext): void {
    this.store.deleteSession(session.sessionHash);
    this.store.appendAudit(
      new Date().toISOString(),
      session.user.id,
      "auth.logout",
      "user",
      session.user.id,
      {},
    );
  }

  getSettings(): PlatformSettings {
    const settings = this.store.getSettings();
    if (!settings) throw new AppError(500, "SETTINGS_MISSING", "平台設定不存在。");
    return settings;
  }

  getReadiness(mailSendingEnabled = false): PlatformReadiness {
    return buildReadiness(this.getSettings(), mailSendingEnabled);
  }

  settingsFor(user: PublicUser): PlatformSettings | Pick<PlatformSettings, "schemaVersion" | "organization"> {
    const settings = this.getSettings();
    if (this.hasPermission(user, "view_scope_settings")) return settings;
    return {
      schemaVersion: settings.schemaVersion,
      organization: settings.organization,
    };
  }

  updateSettings(user: PublicUser, input: unknown): PlatformSettings {
    this.assertPermission(user, "manage_settings");
    const current = this.getSettings();
    let updated: PlatformSettings;
    try {
      updated = applySettingsUpdate(current, input);
    } catch (error) {
      if (error instanceof SettingsValidationError) {
        throw new AppError(400, "INVALID_SETTINGS", error.message);
      }
      throw error;
    }
    const changedFields = changedSettingFields(current, updated);
    if (changedFields.length) {
      this.store.updateSettings(updated, user.id, new Date().toISOString(), changedFields);
    }
    return updated;
  }

  assertPermission(user: PublicUser, permission: Permission): void {
    if (!roleHasPermission(user.role, permission)) {
      throw new AppError(403, "FORBIDDEN", "目前角色沒有執行此操作的權限。");
    }
  }

  hasPermission(user: PublicUser, permission: Permission): boolean {
    return roleHasPermission(user.role, permission);
  }

  listUsers(user: PublicUser): PublicUser[] {
    this.assertPermission(user, "manage_users");
    return this.store.listUsers().map(publicUser);
  }

  async createUser(actor: PublicUser, input: unknown): Promise<PublicUser> {
    this.assertPermission(actor, "manage_users");
    const record = recordFrom(input);
    const username = requiredText(record.username, "帳號", 3, 80);
    if (!/^[\p{L}\p{N}._@-]+$/u.test(username)) {
      throw new AppError(400, "INVALID_INPUT", "帳號只能包含文字、數字、點、底線、@ 或連字號。");
    }
    const displayName = requiredText(record.displayName, "顯示名稱", 2, 80);
    const allowedRoles: AccessRole[] = [
      "system_admin",
      "campaign_creator",
      "reviewer",
      "report_viewer",
    ];
    if (typeof record.role !== "string" || !allowedRoles.includes(record.role as AccessRole)) {
      throw new AppError(400, "INVALID_ROLE", "角色格式不正確。");
    }
    let password: string;
    try {
      password = validatePassword(record.password, username);
    } catch (error) {
      throw new AppError(400, "INVALID_PASSWORD", (error as Error).message);
    }
    const now = new Date().toISOString();
    const user: StoredUser = {
      id: crypto.randomUUID(),
      username,
      usernameNormalized: username.toLowerCase(),
      displayName,
      passwordHash: await hashPassword(password),
      role: record.role as AccessRole,
      status: "active",
      mustChangePassword: true,
      createdAt: now,
      lastLoginAt: null,
    };
    try {
      this.store.createUser(user, actor.id, now);
    } catch (error) {
      if (error instanceof UserAlreadyExistsError) {
        throw new AppError(409, "USER_CONFLICT", "此帳號已存在。");
      }
      throw error;
    }
    return publicUser(user);
  }

  updateUserAccess(actor: PublicUser, userId: string, input: unknown): PublicUser {
    this.assertPermission(actor, "manage_users");
    const record = recordFrom(input);
    const allowedRoles: AccessRole[] = [
      "system_admin",
      "campaign_creator",
      "reviewer",
      "report_viewer",
    ];
    if (typeof record.role !== "string" || !allowedRoles.includes(record.role as AccessRole)) {
      throw new AppError(400, "INVALID_ROLE", "角色格式不正確。");
    }
    if (record.status !== "active" && record.status !== "disabled") {
      throw new AppError(400, "INVALID_STATUS", "帳號狀態格式不正確。");
    }
    try {
      return publicUser(
        this.store.updateUserAccess({
          userId,
          role: record.role as AccessRole,
          status: record.status,
          actorUserId: actor.id,
          occurredAt: new Date().toISOString(),
        }),
      );
    } catch (error) {
      if ((error as Error).message === "USER_NOT_FOUND") {
        throw new AppError(404, "USER_NOT_FOUND", "找不到指定帳號。");
      }
      if ((error as Error).message === "LAST_ADMIN") {
        throw new AppError(409, "LAST_ADMIN", "至少必須保留一個啟用中的系統管理員。");
      }
      throw error;
    }
  }

  async resetUserPassword(actor: PublicUser, userId: string, input: unknown): Promise<void> {
    this.assertPermission(actor, "manage_users");
    const target = this.store.listUsers().find((candidate) => candidate.id === userId);
    if (!target) throw new AppError(404, "USER_NOT_FOUND", "找不到指定帳號。");
    const record = recordFrom(input);
    let password: string;
    try {
      password = validatePassword(record.password, target.username);
    } catch (error) {
      throw new AppError(400, "INVALID_PASSWORD", (error as Error).message);
    }
    this.store.updateUserPassword({
      userId,
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
      actorUserId: actor.id,
      occurredAt: new Date().toISOString(),
    });
  }

  async changeOwnPassword(user: PublicUser, input: unknown): Promise<void> {
    const record = recordFrom(input);
    if (typeof record.currentPassword !== "string") {
      throw new AppError(400, "INVALID_INPUT", "請輸入目前密碼。");
    }
    const stored = this.store.findUserByNormalizedUsername(user.username.toLowerCase());
    if (!stored || !(await verifyPassword(record.currentPassword, stored.passwordHash))) {
      throw new AppError(401, "INVALID_CREDENTIALS", "目前密碼不正確。");
    }
    let password: string;
    try {
      password = validatePassword(record.newPassword, stored.username);
    } catch (error) {
      throw new AppError(400, "INVALID_PASSWORD", (error as Error).message);
    }
    if (await verifyPassword(password, stored.passwordHash)) {
      throw new AppError(400, "PASSWORD_UNCHANGED", "新密碼不可與目前密碼相同。");
    }
    this.store.updateUserPassword({
      userId: stored.id,
      passwordHash: await hashPassword(password),
      mustChangePassword: false,
      actorUserId: stored.id,
      occurredAt: new Date().toISOString(),
    });
  }

  revokeUserSessions(actor: PublicUser, userId: string): number {
    this.assertPermission(actor, "manage_users");
    if (!this.store.listUsers().some((candidate) => candidate.id === userId)) {
      throw new AppError(404, "USER_NOT_FOUND", "找不到指定帳號。");
    }
    const revoked = this.store.deleteUserSessions(userId);
    this.store.appendAudit(new Date().toISOString(), actor.id, "user.sessions_revoked", "user", userId, {
      revoked,
    });
    return revoked;
  }

  getDeliveryControl(user: PublicUser): { emergencyStop: boolean } {
    this.assertPermission(user, "operate_delivery");
    return this.store.getDeliveryControl();
  }

  setEmergencyStop(user: PublicUser, enabled: unknown): { emergencyStop: boolean } {
    this.assertPermission(user, "operate_delivery");
    if (typeof enabled !== "boolean") {
      throw new AppError(400, "INVALID_INPUT", "緊急停止狀態必須是布林值。");
    }
    this.store.setEmergencyStop(enabled, user.id, new Date().toISOString());
    return this.store.getDeliveryControl();
  }

  exportAudit(user: PublicUser): {
    schemaVersion: string;
    generatedAt: string;
    algorithm: string;
    records: Array<Record<string, unknown>>;
    finalHash: string;
    totalRecords: number;
    firstRecordId: number | null;
    lastRecordId: number | null;
    complete: true;
    assurance: "exported_file_consistency_only";
  } {
    this.assertPermission(user, "export_audit");
    const records = this.store.listAuditRecords();
    let previousHash = "0".repeat(64);
    const chained = records.map((record) => {
      const payload = {
        id: record.id,
        occurredAt: record.occurredAt,
        actorUserId: record.actorUserId,
        action: record.action,
        objectType: record.objectType,
        objectId: record.objectId,
        metadata: record.metadata,
        previousHash,
      };
      const hash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      previousHash = hash;
      return { ...payload, hash };
    });
    return {
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      algorithm: "SHA-256 hash chain",
      records: chained,
      finalHash: previousHash,
      totalRecords: records.length,
      firstRecordId: records.at(0)?.id ?? null,
      lastRecordId: records.at(-1)?.id ?? null,
      complete: true,
      assurance: "exported_file_consistency_only",
    };
  }

  private createSession(user: StoredUser, now: string): NewSessionResult {
    this.store.deleteExpiredSessions(now);
    const sessionToken = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const expiresAt = new Date(Date.parse(now) + this.sessionTtlMs).toISOString();
    this.store.createSession({
      sessionHash: hashToken(sessionToken),
      csrfHash: hashToken(csrfToken),
      userId: user.id,
      createdAt: now,
      expiresAt,
    });
    return { sessionToken, csrfToken, expiresAt, user: publicUser(user) };
  }

  private publicSession(session: StoredSession): SessionContext {
    return {
      sessionHash: session.sessionHash,
      csrfHash: session.csrfHash,
      expiresAt: session.expiresAt,
      user: publicUser(session.user),
    };
  }
}

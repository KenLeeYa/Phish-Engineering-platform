import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface VaultRecord {
  iv: string;
  authTag: string;
  ciphertext: string;
  createdAt: string;
}

interface VaultFile {
  schemaVersion: 1;
  records: Record<string, VaultRecord>;
}

export class SecretVaultUnavailableError extends Error {}

export class SecretVault {
  private readonly key: Buffer | null;

  constructor(
    private readonly filePath: string,
    encodedKey: string | undefined,
  ) {
    if (!encodedKey?.trim()) {
      this.key = null;
      return;
    }
    const decoded = Buffer.from(encodedKey.trim(), "base64");
    if (decoded.length !== 32) {
      throw new SecretVaultUnavailableError("SEA_MASTER_KEY 必須是 32 bytes 的 Base64 金鑰。");
    }
    this.key = decoded;
  }

  isAvailable(): boolean {
    return Boolean(this.key);
  }

  put(reference: string, value: string): void {
    if (!this.key) throw new SecretVaultUnavailableError("尚未設定 SEA_MASTER_KEY，不能保存 SMTP 秘密。");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(reference, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const vault = this.readFile();
    vault.records[reference] = {
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(vault, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporary, this.filePath);
  }

  get(reference: string): string {
    if (!this.key) throw new SecretVaultUnavailableError("尚未設定 SEA_MASTER_KEY，不能讀取 SMTP 秘密。");
    const record = this.readFile().records[reference];
    if (!record) throw new SecretVaultUnavailableError("找不到指定 SMTP 秘密。");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(record.iv, "base64"),
    );
    decipher.setAAD(Buffer.from(reference, "utf8"));
    decipher.setAuthTag(Buffer.from(record.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  private readFile(): VaultFile {
    if (!fs.existsSync(this.filePath)) return { schemaVersion: 1, records: {} };
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as VaultFile;
    if (parsed.schemaVersion !== 1 || !parsed.records || typeof parsed.records !== "object") {
      throw new SecretVaultUnavailableError("秘密檔格式不正確。");
    }
    return parsed;
  }
}

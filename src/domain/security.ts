import crypto from "node:crypto";

const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const KEY_LENGTH = 64;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: 64 * 1024 * 1024,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(Buffer.from(key));
      },
    );
  });
}

export function validatePassword(password: unknown, username: string): string {
  if (typeof password !== "string") throw new Error("密碼格式不正確。");
  const length = [...password].length;
  if (length < 12 || length > 128) throw new Error("密碼長度必須介於 12 到 128 個字元。");
  if (password.toLowerCase().includes(username.toLowerCase())) {
    throw new Error("密碼不可包含完整管理員帳號。");
  }
  return password;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await deriveKey(password, salt);
  return [
    "scrypt",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, saltValue, keyValue] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    Number(cost) !== SCRYPT_COST ||
    Number(blockSize) !== SCRYPT_BLOCK_SIZE ||
    Number(parallelization) !== SCRYPT_PARALLELIZATION ||
    !saltValue ||
    !keyValue
  ) {
    return false;
  }

  try {
    const expected = Buffer.from(keyValue, "base64url");
    const actual = await deriveKey(password, Buffer.from(saltValue, "base64url"));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createOpaqueToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokensMatch(first: string, second: string): boolean {
  const left = Buffer.from(first, "utf8");
  const right = Buffer.from(second, "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

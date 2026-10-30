export interface ScriptScryptParams {
  N: number;
  r: number;
  p: number;
  keylen: number;
}

export function hashPassword(
  password: string,
  salt?: Buffer,
  params?: ScriptScryptParams,
): Promise<string>;

export function generateSecret(): string;

export function isPasswordHash(value: unknown): value is string;

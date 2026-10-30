export function readEnvFile(filePath: string): Promise<Map<string, string>>;

export function readEnvText(filePath: string): Promise<string>;

export function upsertEnv(text: string, values: Record<string, string>): string;

export function writeEnvValues(filePath: string, values: Record<string, string>): Promise<void>;

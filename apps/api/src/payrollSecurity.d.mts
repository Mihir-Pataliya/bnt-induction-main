export function getPayrollEncryptionKey(configured: string | undefined): Buffer;
export function encryptPayrollValue(value: string, key: Buffer): string;
export function decryptPayrollValue(value: string | null, key: Buffer): string;

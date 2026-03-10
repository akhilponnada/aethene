const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return bytesToHex(new Uint8Array(digest));
}

async function importEncryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
}

export async function hashApiKey(apiKey: string): Promise<string> {
  const pepper = process.env.API_KEY_HASH_PEPPER || '';
  return `sha256:${await sha256(`${pepper}:${apiKey}`)}`;
}

/**
 * Encrypt connector secrets before they are persisted to Convex.
 */
export async function encryptStoredSecret(secret: string): Promise<string> {
  const encryptionKey = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('SETTINGS_ENCRYPTION_KEY is required to store connector secrets securely');
  }

  const key = await importEncryptionKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(secret)
  );

  return `enc:v1:${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}

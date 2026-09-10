/**
 * Web Crypto API Utility for Client-Side AES-256-GCM End-to-End Encryption
 */
const CryptoUtil = (() => {
  const ALGORITHM = 'AES-GCM';
  const KEY_LENGTH = 256;
  const IV_LENGTH = 12; // 96-bit IV recommended for AES-GCM
  const PBKDF2_ITERATIONS = 100000;

  /**
   * Derives a cryptographic key from a Room ID and optional passcode
   */
  async function deriveRoomKey(roomId, passcode = '') {
    const encoder = new TextEncoder();
    const rawSecret = encoder.encode(roomId + ':' + (passcode || 'default_room_secret'));
    const salt = encoder.encode('webrtc_collab_salt_' + roomId);

    const baseKey = await window.crypto.subtle.importKey(
      'raw',
      rawSecret,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    return window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      },
      baseKey,
      { name: ALGORITHM, length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypts an ArrayBuffer using AES-256-GCM
   * Returns: Uint8Array [12-byte IV + ciphertext + 16-byte tag]
   */
  async function encryptBuffer(buffer, key) {
    const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: ALGORITHM, iv: iv },
      key,
      buffer
    );

    const result = new Uint8Array(iv.byteLength + ciphertext.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(ciphertext), iv.byteLength);
    return result.buffer;
  }

  /**
   * Decrypts an ArrayBuffer containing [12-byte IV + ciphertext] using AES-256-GCM
   */
  async function decryptBuffer(encryptedBuffer, key) {
    const raw = new Uint8Array(encryptedBuffer);
    if (raw.byteLength < IV_LENGTH + 16) {
      throw new Error('Encrypted payload too small or corrupted');
    }

    const iv = raw.slice(0, IV_LENGTH);
    const ciphertext = raw.slice(IV_LENGTH);

    return window.crypto.subtle.decrypt(
      { name: ALGORITHM, iv: iv },
      key,
      ciphertext
    );
  }

  /**
   * Computes SHA-256 hex digest of an ArrayBuffer
   */
  async function computeSha256(buffer) {
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Encrypts a string message
   */
  async function encryptText(text, key) {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    const encrypted = await encryptBuffer(encoded.buffer, key);
    // Convert to base64 for transmission
    let binary = '';
    const bytes = new Uint8Array(encrypted);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /**
   * Decrypts a base64 encoded string
   */
  async function decryptText(base64Str, key) {
    const binary = window.atob(base64Str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decrypted = await decryptBuffer(bytes.buffer, key);
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  /**
   * Generates a user-verifiable cryptographic fingerprint for the room E2EE session
   */
  async function getRoomFingerprint(roomId, passcode = '') {
    const encoder = new TextEncoder();
    const data = encoder.encode(`session_fingerprint:${roomId}:${passcode || 'default_room_secret'}`);
    const hash = await computeSha256(data);
    return hash.toUpperCase().match(/.{1,4}/g).slice(0, 8).join('-');
  }

  return {
    deriveRoomKey,
    getRoomFingerprint,
    encryptBuffer,
    decryptBuffer,
    computeSha256,
    encryptText,
    decryptText
  };
})();

if (typeof window !== 'undefined') {
  window.CryptoUtil = CryptoUtil;
}

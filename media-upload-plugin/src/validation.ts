import { MAX_UPLOAD_BYTES } from './types';

const SAFE_NAME_PATTERN = /[^a-zA-Z0-9._-]+/g;
const SAFE_COLLECTION_PATTERN = /[^a-zA-Z0-9_-]+/g;
const SUPPORTED_MEDIA_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function sanitizeFileName(input: string): string {
  const leaf = input.split(/[\\/]/).at(-1) ?? '';
  const cleaned = leaf
    .normalize('NFKC')
    .replace(/\0/g, '')
    .replace(SAFE_NAME_PATTERN, '-')
    .replace(/^[.-]+/, '')
    .replace(/-+/g, '-')
    .slice(0, 180);
  return cleaned || 'upload';
}

export function sanitizeCollection(input: string): string {
  const cleaned = input
    .normalize('NFKC')
    .trim()
    .replace(SAFE_COLLECTION_PATTERN, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 80);
  if (!cleaned) {
    throw new Error('collection is required');
  }
  return cleaned;
}

export function validateMediaType(mimeType: string): void {
  if (!SUPPORTED_MEDIA_TYPES.has(mimeType)) {
    throw new Error('Only PNG, JPEG, WebP, GIF, and PDF files are allowed');
  }
}

export function validateMediaBytes(bytes: Buffer, mimeType: string): void {
  const matches =
    (mimeType === 'image/png' &&
      startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (mimeType === 'image/jpeg' && startsWith(bytes, [0xff, 0xd8, 0xff])) ||
    (mimeType === 'image/gif' &&
      (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' ||
        bytes.subarray(0, 6).toString('ascii') === 'GIF89a')) ||
    (mimeType === 'image/webp' &&
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP') ||
    (mimeType === 'application/pdf' &&
      bytes.subarray(0, 5).toString('ascii') === '%PDF-');

  if (!matches) {
    throw new Error('File contents do not match the declared media type');
  }
}

export function validateMediaSize(sizeBytes: number): void {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error('The uploaded file is empty');
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    throw new Error('File exceeds the 20 MB limit');
  }
}

export function buildMediaPath(collection: string, id: string, fileName: string): string {
  return `${sanitizeCollection(collection)}/${id}/${sanitizeFileName(fileName)}`;
}

import type { MediaAsset, MediaUploadOptions } from './types';

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Media request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function uploadUrl(path: string, file: File, options: MediaUploadOptions): string {
  const params = new URLSearchParams({
    collection: options.collection,
    path: options.fileName ?? file.name,
  });
  return `${path}?${params.toString()}`;
}

export async function uploadMedia(
  file: File,
  options: MediaUploadOptions,
): Promise<MediaAsset> {
  const response = await fetch(uploadUrl('/api/media/upload', file, options), {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  return parseResponse<MediaAsset>(response);
}

export async function replaceMedia(
  mediaId: string,
  file: File,
  options: MediaUploadOptions,
): Promise<MediaAsset> {
  const response = await fetch(
    uploadUrl(`/api/media/${encodeURIComponent(mediaId)}`, file, options),
    {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    },
  );
  return parseResponse<MediaAsset>(response);
}

export async function getMediaMeta(mediaId: string): Promise<MediaAsset> {
  const response = await fetch(`/api/media/${encodeURIComponent(mediaId)}/meta`);
  return parseResponse<MediaAsset>(response);
}

export async function deleteMedia(mediaId: string): Promise<void> {
  const response = await fetch(`/api/media/${encodeURIComponent(mediaId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Delete failed (${response.status})`);
  }
}

export const mediaRawUrl = (mediaId: string) =>
  `/api/media/${encodeURIComponent(mediaId)}/raw`;

export const mediaThumbUrl = (mediaId: string) =>
  `/api/media/${encodeURIComponent(mediaId)}/thumb`;

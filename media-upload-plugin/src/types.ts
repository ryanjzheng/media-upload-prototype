export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface MediaAsset {
  id: string;
  collection: string;
  volumePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  thumbPath: string | null;
  checksum: string;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MediaUploadOptions {
  collection: string;
  fileName?: string;
}

export interface MediaApiError {
  error: string;
}

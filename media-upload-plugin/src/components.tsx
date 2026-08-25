import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useState,
} from 'react';
import {
  deleteMedia,
  getMediaMeta,
  mediaRawUrl,
  mediaThumbUrl,
  replaceMedia,
  uploadMedia,
} from './api';
import { MAX_UPLOAD_BYTES, type MediaAsset } from './types';

export type { MediaAsset } from './types';

export interface MediaUploadProps {
  collection: string;
  mediaId?: string | null;
  compact?: boolean;
  disabled?: boolean;
  onUploaded(asset: MediaAsset): void;
  onError?(error: Error): void;
}

export function MediaUpload({
  collection,
  mediaId,
  compact = false,
  disabled = false,
  onUploaded,
  onError,
}: MediaUploadProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (file: File) => {
    setError(null);
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
      const nextError = new Error('Choose an image or PDF file');
      setError(nextError.message);
      onError?.(nextError);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      const nextError = new Error('File exceeds the 20 MB limit');
      setError(nextError.message);
      onError?.(nextError);
      return;
    }
    setUploading(true);
    try {
      const asset = mediaId
        ? await replaceMedia(mediaId, file, { collection })
        : await uploadMedia(file, { collection });
      onUploaded(asset);
    } catch (caught) {
      const nextError =
        caught instanceof Error ? caught : new Error('Upload failed');
      setError(nextError.message);
      onError?.(nextError);
    } finally {
      setUploading(false);
    }
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void submit(file);
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !disabled && !uploading) void submit(file);
  };

  return (
    <div className={compact ? 'media-upload media-upload--compact' : 'media-upload'}>
      <label
        className={`media-upload__dropzone${dragging ? ' is-dragging' : ''}`}
        htmlFor={inputId}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="media-upload__icon" aria-hidden="true">
          ↑
        </span>
        <span className="media-upload__title">
          {uploading
            ? 'Uploading…'
            : mediaId
              ? 'Replace media'
              : compact
                ? 'Add media'
                : 'Drop an image or PDF here'}
        </span>
        {!compact && (
          <span className="media-upload__hint">
            or choose a file · PNG, JPEG, WebP, GIF, or PDF · 20 MB max
          </span>
        )}
      </label>
      <input
        id={inputId}
        className="media-upload__input"
        type="file"
        accept="image/*,application/pdf"
        disabled={disabled || uploading}
        onChange={onChange}
      />
      {error && (
        <p className="media-upload__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export interface MediaCellProps {
  mediaId: string | null;
  collection: string;
  editable?: boolean;
  label?: string;
  onChange?(asset: MediaAsset | null): void;
}

export function MediaCell({
  mediaId,
  collection,
  editable = false,
  label = 'Attached media',
  onChange,
}: MediaCellProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (!mediaId || !window.confirm('Remove this media attachment?')) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteMedia(mediaId);
      onChange?.(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  if (!mediaId) {
    return editable ? (
      <MediaUpload
        compact
        collection={collection}
        onUploaded={(asset) => onChange?.(asset)}
      />
    ) : (
      <span className="media-cell__empty">No media</span>
    );
  }

  return (
    <div className="media-cell">
      <button
        className="media-cell__preview"
        type="button"
        aria-label={`Preview ${label}`}
        onClick={() => setPreviewOpen(true)}
      >
        <img
          src={`${mediaThumbUrl(mediaId)}?v=${version}`}
          alt=""
          loading="lazy"
        />
      </button>
      {editable && (
        <div className="media-cell__actions">
          <MediaUpload
            compact
            collection={collection}
            mediaId={mediaId}
            onUploaded={(asset) => {
              setVersion((value) => value + 1);
              onChange?.(asset);
            }}
          />
          <button
            className="media-link media-link--danger"
            type="button"
            disabled={deleting}
            onClick={() => void remove()}
          >
            {deleting ? 'Removing…' : 'Remove'}
          </button>
        </div>
      )}
      {error && (
        <span className="media-upload__error" role="alert">
          {error}
        </span>
      )}
      {previewOpen && (
        <MediaPreview mediaId={mediaId} onClose={() => setPreviewOpen(false)} />
      )}
    </div>
  );
}

export interface MediaPreviewProps {
  mediaId: string;
  onClose(): void;
}

export function MediaPreview({ mediaId, onClose }: MediaPreviewProps) {
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getMediaMeta(mediaId)
      .then((value) => {
        if (active) setAsset(value);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Preview failed');
        }
      });
    return () => {
      active = false;
    };
  }, [mediaId]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const onBackdropKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') onClose();
  };

  return (
    <div
      className="media-preview"
      role="dialog"
      aria-modal="true"
      aria-label="Media preview"
      tabIndex={-1}
      onKeyDown={onBackdropKeyDown}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className="media-preview__panel">
        <header className="media-preview__header">
          <div>
            <strong>{asset?.fileName ?? 'Loading preview…'}</strong>
            {asset && (
              <span>
                {(asset.sizeBytes / 1024 / 1024).toFixed(2)} MB ·{' '}
                {asset.mimeType}
              </span>
            )}
          </div>
          <button
            className="media-preview__close"
            type="button"
            aria-label="Close preview"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="media-preview__body">
          {error && (
            <p className="media-upload__error" role="alert">
              {error}
            </p>
          )}
          {!asset && !error && <div className="media-preview__loading" />}
          {asset?.mimeType.startsWith('image/') && (
            <img src={mediaRawUrl(mediaId)} alt={asset.fileName} />
          )}
          {asset?.mimeType === 'application/pdf' && (
            <iframe src={mediaRawUrl(mediaId)} title={asset.fileName} />
          )}
        </div>
        {asset && (
          <footer className="media-preview__footer">
            <span>
              Uploaded by {asset.uploadedBy} ·{' '}
              {new Date(asset.updatedAt).toLocaleString()}
            </span>
            <a
              className="media-link"
              href={mediaRawUrl(mediaId)}
              target="_blank"
              rel="noreferrer"
            >
              Open original
            </a>
          </footer>
        )}
      </div>
    </div>
  );
}

import {
  MediaCell,
  MediaPreview,
  MediaUpload,
  type MediaAsset,
} from 'media-upload-plugin/react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@databricks/appkit-ui/react';
import { FileImage, Pencil, RefreshCw, ShieldCheck, UploadCloud } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface RecordRow {
  id: string;
  name: string;
  category: string;
  status: string;
  location: string;
  photo_media_id: string | null;
  updated_at: string;
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export default function App() {
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [standaloneAsset, setStandaloneAsset] = useState<MediaAsset | null>(null);
  const [standalonePreview, setStandalonePreview] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RecordRow | null>(null);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await responseJson<RecordRow[]>(await fetch('/api/records')));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const updatePhoto = async (recordId: string, asset: MediaAsset | null) => {
    try {
      const updated = await responseJson<RecordRow>(
        await fetch(`/api/records/${encodeURIComponent(recordId)}/photo`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mediaId: asset?.id ?? null }),
        }),
      );
      setRecords((current) =>
        current.map((record) => (record.id === recordId ? updated : record)),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Unable to update record photo',
      );
      await loadRecords();
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          <FileImage size={20} />
        </div>
        <div>
          <strong>Media reference</strong>
          <span>Databricks Apps prototype</span>
        </div>
        <div className="topbar__trust">
          <ShieldCheck size={16} />
          Unity Catalog governed
        </div>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">Reusable AppKit component</p>
            <h1>Records with governed media</h1>
            <p className="hero__copy">
              Attach images and PDFs to operational records. Bytes are stored in a
              managed Volume under the signed-in user; metadata stays in Lakebase.
            </p>
          </div>
          <div className="hero__metric" aria-label={`${records.length} demo records`}>
            <span>{records.length}</span>
            demo records
          </div>
        </section>

        <section aria-labelledby="records-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Consumer integration</p>
              <h2 id="records-heading">Field asset records</h2>
            </div>
            <Button variant="outline" size="sm" onClick={() => void loadRecords()}>
              <RefreshCw size={14} />
              Refresh
            </Button>
          </div>

          {error && (
            <div className="state-panel state-panel--error" role="alert">
              <strong>Could not complete the request</strong>
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => void loadRecords()}>
                Try again
              </Button>
            </div>
          )}

          {loading && (
            <div className="record-skeletons" aria-label="Loading records">
              {Array.from({ length: 4 }).map((_, index) => (
                <div className="record-skeleton" key={index} />
              ))}
            </div>
          )}

          {!loading && !error && records.length === 0 && (
            <div className="state-panel">
              <FileImage size={24} />
              <strong>No records yet</strong>
              <span>Seed records will appear after Lakebase initialization.</span>
            </div>
          )}

          {!loading && records.length > 0 && (
            <div className="records-surface">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Record</th>
                    <th scope="col">Location</th>
                    <th scope="col">Status</th>
                    <th scope="col">Media</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id}>
                      <td data-label="Record">
                        <strong>{record.name}</strong>
                        <span>{record.category}</span>
                      </td>
                      <td data-label="Location">{record.location}</td>
                      <td data-label="Status">
                        <span
                          className={`status status--${record.status
                            .toLowerCase()
                            .replace(/\s+/g, '-')}`}
                        >
                          {record.status}
                        </span>
                      </td>
                      <td data-label="Media">
                        <MediaCell
                          mediaId={record.photo_media_id}
                          collection="record-photos"
                          editable
                          label={`${record.name} media`}
                          onChange={(asset) => void updatePhoto(record.id, asset)}
                        />
                      </td>
                      <td data-label="Actions">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingRecord(record)}
                        >
                          <Pencil size={14} />
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="standalone-section" aria-labelledby="standalone-heading">
          <Card>
            <CardHeader>
              <div className="card-heading">
                <div className="card-heading__icon" aria-hidden="true">
                  <UploadCloud size={20} />
                </div>
                <div>
                  <p className="eyebrow">Standalone widget</p>
                  <CardTitle id="standalone-heading">Upload to the media library</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <MediaUpload
                collection="standalone"
                onUploaded={setStandaloneAsset}
              />
              {standaloneAsset && (
                <div className="upload-success" role="status">
                  <img
                    src={`/api/media/${encodeURIComponent(
                      standaloneAsset.id,
                    )}/thumb`}
                    alt=""
                  />
                  <div>
                    <strong>{standaloneAsset.fileName}</strong>
                    <span>
                      {(standaloneAsset.sizeBytes / 1024 / 1024).toFixed(2)} MB ·
                      uploaded
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStandalonePreview(true)}
                  >
                    Preview
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </main>

      <footer>
        Prototype · image/PDF only · 20 MB maximum · soft delete enabled
      </footer>

      {editingRecord && (
        <RecordActionForm
          record={editingRecord}
          onClose={() => setEditingRecord(null)}
          onSaved={(updated) => {
            setRecords((current) =>
              current.map((record) =>
                record.id === updated.id ? updated : record,
              ),
            );
            setEditingRecord(null);
          }}
        />
      )}

      {standaloneAsset && standalonePreview && (
        <MediaPreview
          mediaId={standaloneAsset.id}
          onClose={() => setStandalonePreview(false)}
        />
      )}
    </div>
  );
}

interface RecordActionFormProps {
  record: RecordRow;
  onClose: () => void;
  onSaved: (record: RecordRow) => void;
}

/**
 * Action form: opens on a record, pre-fills all of its editable properties,
 * and embeds the reusable <MediaUpload> widget. One save uploads the attached
 * media to the Volume (via MediaUpload → mediaId) AND writes the edited fields
 * + photo_media_id back to the record in a single PATCH.
 */
function RecordActionForm({ record, onClose, onSaved }: RecordActionFormProps) {
  const [name, setName] = useState(record.name);
  const [category, setCategory] = useState(record.category);
  const [status, setStatus] = useState(record.status);
  const [location, setLocation] = useState(record.location);
  const [photoMediaId, setPhotoMediaId] = useState<string | null>(
    record.photo_media_id,
  );
  const [thumbVersion, setThumbVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await responseJson<RecordRow>(
        await fetch(`/api/records/${encodeURIComponent(record.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            category,
            status,
            location,
            photo_media_id: photoMediaId,
          }),
        }),
      );
      onSaved(updated);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save record');
      setSaving(false);
    }
  };

  return (
    <div
      className="action-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${record.name}`}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <form
        className="action-modal__panel"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <header className="action-modal__header">
          <div>
            <p className="eyebrow">Record action</p>
            <strong>Edit “{record.name}”</strong>
          </div>
          <button
            className="action-modal__close"
            type="button"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="action-modal__body">
          <div className="action-grid">
            <label className="action-field">
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <label className="action-field">
              <span>Category</span>
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                required
              />
            </label>
            <label className="action-field">
              <span>Status</span>
              <input
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                required
              />
            </label>
            <label className="action-field">
              <span>Location</span>
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                required
              />
            </label>
          </div>

          <div className="action-photo">
            <div className="action-photo__label">
              <span>Photo</span>
              {photoMediaId && (
                <button
                  className="media-link media-link--danger"
                  type="button"
                  onClick={() => setPhotoMediaId(null)}
                >
                  Detach
                </button>
              )}
            </div>
            {photoMediaId && (
              <img
                className="action-photo__preview"
                src={`/api/media/${encodeURIComponent(
                  photoMediaId,
                )}/thumb?v=${thumbVersion}`}
                alt=""
              />
            )}
            <MediaUpload
              collection="record-photos"
              mediaId={photoMediaId}
              onUploaded={(asset) => {
                setPhotoMediaId(asset.id);
                setThumbVersion((value) => value + 1);
              }}
              onError={(caught) => setError(caught.message)}
            />
          </div>

          {error && (
            <p className="media-upload__error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="action-modal__footer">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? 'Saving…' : 'Save record'}
          </Button>
        </footer>
      </form>
    </div>
  );
}

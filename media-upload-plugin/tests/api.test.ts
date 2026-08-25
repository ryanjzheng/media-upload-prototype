import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteMedia, uploadMedia } from '../src/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('media API client', () => {
  it('uploads raw bytes only through the app media route', async () => {
    const asset = { id: 'asset-1', fileName: 'tower.jpg' };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(asset), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['image'], 'tower photo.jpg', { type: 'image/jpeg' });

    await expect(
      uploadMedia(file, { collection: 'record-photos' }),
    ).resolves.toMatchObject(asset);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/media/upload?');
    expect(url).toContain('collection=record-photos');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(file);
  });

  it('surfaces API errors and uses soft-delete endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Media asset not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteMedia('missing')).rejects.toThrow(
      'Media asset not found',
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/media/missing', {
      method: 'DELETE',
    });
  });
});

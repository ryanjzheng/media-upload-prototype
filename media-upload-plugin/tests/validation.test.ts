import { describe, expect, it } from 'vitest';
import {
  buildMediaPath,
  sanitizeCollection,
  sanitizeFileName,
  validateMediaBytes,
  validateMediaSize,
  validateMediaType,
} from '../src/validation';

describe('media validation', () => {
  it('removes traversal and unsafe filename characters', () => {
    expect(sanitizeFileName('../../Quarterly report (final).pdf')).toBe(
      'Quarterly-report-final-.pdf',
    );
    expect(sanitizeFileName('..\\..\\photo.jpg')).toBe('photo.jpg');
  });

  it('builds collection/uuid/file paths', () => {
    expect(
      buildMediaPath(
        'record photos',
        '11111111-1111-4111-8111-111111111111',
        '../tower 1.jpg',
      ),
    ).toBe('record-photos/11111111-1111-4111-8111-111111111111/tower-1.jpg');
  });

  it('rejects missing collections', () => {
    expect(() => sanitizeCollection(' ../../ ')).toThrow(
      'collection is required',
    );
  });

  it('accepts images and PDFs only', () => {
    expect(() => validateMediaType('image/jpeg')).not.toThrow();
    expect(() => validateMediaType('application/pdf')).not.toThrow();
    expect(() => validateMediaType('text/html')).toThrow(/^Only PNG/);
  });

  it('rejects malformed or mislabeled media bytes', () => {
    expect(() =>
      validateMediaBytes(Buffer.from('not a png'), 'image/png'),
    ).toThrow(/do not match/);
    expect(() =>
      validateMediaBytes(Buffer.from('%PDF-1.7'), 'image/png'),
    ).toThrow(/do not match/);
  });

  it('accepts supported media signatures', () => {
    expect(() =>
      validateMediaBytes(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        'image/png',
      ),
    ).not.toThrow();
    expect(() =>
      validateMediaBytes(Buffer.from('%PDF-1.7'), 'application/pdf'),
    ).not.toThrow();
  });

  it('enforces non-empty files and the 20 MB cap', () => {
    expect(() => validateMediaSize(1)).not.toThrow();
    expect(() => validateMediaSize(0)).toThrow('empty');
    expect(() => validateMediaSize(20 * 1024 * 1024 + 1)).toThrow('20 MB');
  });
});

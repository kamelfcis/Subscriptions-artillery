import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FilePreview, { isImage, isPdf } from './FilePreview';

describe('FilePreview MIME helpers', () => {
  it('detects image/* MIME types', () => {
    expect(isImage('image/jpeg')).toBe(true);
    expect(isImage('image/png')).toBe(true);
    expect(isImage('image/webp')).toBe(true);
    expect(isImage('application/pdf')).toBe(false);
    expect(isImage('')).toBe(false);
    expect(isImage(null)).toBe(false);
  });

  it('detects application/pdf only', () => {
    expect(isPdf('application/pdf')).toBe(true);
    expect(isPdf('image/jpeg')).toBe(false);
    expect(isPdf('application/x-pdf')).toBe(false);
    expect(isPdf('')).toBe(false);
  });
});

describe('FilePreview modal', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:preview-test');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.restoreAllMocks();
  });

  it('renders nothing interactive when file is null', () => {
    const { container } = render(<FilePreview file={null} onClose={() => {}} />);
    expect(container.querySelector('.file-preview')).toBeNull();
  });

  it('loads image in-page (modal) without window.open', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
      headers: { get: () => 'image/png' },
    }));

    const onClose = vi.fn();
    render(<FilePreview file={{ id: 42, discip: 'هوية' }} onClose={onClose} />);

    expect(await screen.findByRole('dialog')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByAltText('هوية')).toBeTruthy();
    });
    expect(openSpy).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/files\/42\/content/),
      expect.objectContaining({ credentials: 'same-origin' })
    );

    fireEvent.click(screen.getByRole('button', { name: /^إغلاق$/ }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders PDF iframe for application/pdf', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' }),
      headers: { get: () => 'application/pdf' },
    }));

    render(<FilePreview file={{ id: 7, discip: 'مستند' }} onClose={() => {}} />);
    const frame = await screen.findByTitle('مستند');
    expect(frame.tagName).toBe('IFRAME');
    expect(screen.getByRole('button', { name: /طباعة/ })).toBeTruthy();
  });
});

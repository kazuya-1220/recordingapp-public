import { useEffect, useState } from 'react';
import { X, Download, FileText, ExternalLink } from 'lucide-react';

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif'];

function extOf(name: string): string {
  return (name.split('.').pop() || '').toLowerCase();
}

// iOS Safari renders PDFs inside <iframe> as a blank page, and modal previews
// are generally flaky (blob URLs, popup rules, viewport issues). Detect iOS so
// we can hand off to the system viewer via window.open on tap.
const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** True when the URL is a server-hosted file (not a local blob URL). */
function isServerUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith('/');
}

/**
 * Attach a display name (and optional force-download flag) to a server-hosted
 * `/api/files/…` URL so the browser uses that name in the download dialog and
 * the file's inline viewer. Blob URLs are returned unchanged.
 */
function withDisplayName(url: string, name: string, download = false): string {
  if (!isServerUrl(url) || !name) return url;
  try {
    const u = new URL(url, window.location.origin);
    if (u.pathname.startsWith('/api/files/')) {
      u.searchParams.set('name', name);
      if (download) u.searchParams.set('download', '1');
      return u.pathname + '?' + u.searchParams.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/** Trigger a browser download of an attachment, using the display name. */
export function downloadAttachment(url: string, name: string) {
  const target = withDisplayName(url, name, true);
  const a = document.createElement('a');
  a.href = target;
  // Same-origin + server-set Content-Disposition handles the filename; the
  // download attribute is kept as a fallback for blob URLs.
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Open an attachment for inline preview.
 * - On iOS: hand off directly to Safari (system viewer), which handles both
 *   images and PDFs reliably — bypasses the whiteout we get from in-app modals.
 * - Elsewhere: render inside the modal below.
 * Returns true if the caller should render the modal (i.e. non-iOS), false if
 * the preview was handled by opening a new tab.
 */
export function openAttachmentInPlace(url: string, name: string): boolean {
  const target = withDisplayName(url, name);
  if (IS_IOS) {
    window.open(target, '_blank', 'noopener,noreferrer');
    return false;
  }
  return true;
}

/**
 * Full-screen preview of an attachment for non-iOS browsers. Images render
 * inline, PDFs in an iframe, anything else falls back to a download / open
 * prompt. There is always an "open in new tab" + download escape hatch so the
 * modal is never a dead white screen.
 */
export function AttachmentPreviewModal({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  const ext = extOf(name);
  const isImage = IMAGE_EXT.includes(ext);
  const isPdf = ext === 'pdf';
  const [imgError, setImgError] = useState(false);
  const viewUrl = withDisplayName(url, name);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const OpenInNewTab = ({ big = false }: { big?: boolean }) => (
    <a
      href={viewUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={big
        ? 'inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors active:scale-95'
        : 'p-2 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors active:scale-90'}
    >
      <ExternalLink className={big ? 'w-4 h-4' : 'w-5 h-5'} />
      {big && '別のタブで開く'}
    </a>
  );

  const Fallback = ({ message }: { message: string }) => (
    <div className="text-center p-10 text-slate-500 dark:text-slate-400">
      <FileText className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
      <p className="text-sm font-semibold mb-4">{message}</p>
      <div className="flex items-center justify-center gap-2">
        <OpenInNewTab big />
        <button
          type="button"
          onClick={() => downloadAttachment(url, name)}
          className="inline-flex items-center gap-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-sm font-bold px-4 py-2 rounded-lg transition-colors active:scale-95 border border-slate-200 dark:border-slate-600"
        >
          <Download className="w-4 h-4" />
          ダウンロード
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-[84rem] max-h-[95vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <FileText className="w-4 h-4 text-slate-400 shrink-0" />
          <span className="flex-1 truncate font-bold text-sm text-slate-800 dark:text-slate-100">{name}</span>
          <OpenInNewTab />
          <button
            type="button"
            title="ダウンロード"
            onClick={() => downloadAttachment(url, name)}
            className="p-2 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors active:scale-90"
          >
            <Download className="w-5 h-5" />
          </button>
          <button
            type="button"
            title="閉じる"
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-red-500 dark:text-slate-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors active:scale-90"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto bg-slate-100 dark:bg-slate-900 flex items-center justify-center min-h-[300px]">
          {isImage && !imgError ? (
            <img src={viewUrl} alt={name} className="max-w-full max-h-[88vh] object-contain" onError={() => setImgError(true)} />
          ) : isPdf ? (
            <iframe src={viewUrl} title={name} className="w-full h-[88vh] bg-white" />
          ) : (
            <Fallback message="この形式はプレビューに対応していません" />
          )}
        </div>
      </div>
    </div>
  );
}

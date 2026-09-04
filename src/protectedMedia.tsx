import {
  useEffect,
  useState,
  type CSSProperties,
  type ImgHTMLAttributes,
  type ReactNode
} from 'react';
import { apiBlob, openProtectedResource } from './api';

function canUseDirectly(source: string): boolean {
  return (
    source.startsWith('data:') ||
    source.startsWith('blob:') ||
    source.startsWith('/api/public/') ||
    source.startsWith('http://') ||
    source.startsWith('https://')
  );
}

export function AuthenticatedImage({
  source,
  fallback = null,
  link = false,
  onError,
  ...imageProps
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  source?: string;
  fallback?: ReactNode;
  link?: boolean;
}) {
  const [resolvedSource, setResolvedSource] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    const value = String(source || '');

    setFailed(false);
    setResolvedSource('');

    if (!value) {
      return () => undefined;
    }

    if (canUseDirectly(value)) {
      setResolvedSource(value);
      return () => undefined;
    }

    apiBlob(value)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setResolvedSource(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source]);

  if (!source || failed || !resolvedSource) {
    return <>{fallback}</>;
  }

  const image = (
    <img
      {...imageProps}
      src={resolvedSource}
      onError={(event) => {
        setFailed(true);
        onError?.(event);
      }}
    />
  );

  if (!link) return image;

  return (
    <a
      href={resolvedSource}
      target="_blank"
      rel="noreferrer"
      style={{ display: 'block', textAlign: 'center' }}
    >
      {image}
    </a>
  );
}

export function ProtectedFileButton({
  source,
  children,
  className,
  style
}: {
  source: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function openFile() {
    if (!source || busy) return;
    setBusy(true);
    setError('');

    try {
      await openProtectedResource(source);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ไม่สามารถเปิดเอกสารได้');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button
        type="button"
        className={className}
        style={style}
        disabled={busy}
        onClick={() => void openFile()}
        title={error || undefined}
      >
        {busy ? 'กำลังเปิด...' : children}
      </button>
      {error && (
        <small style={{ display: 'block', marginTop: 4, color: '#b91c1c' }}>
          {error}
        </small>
      )}
    </span>
  );
}

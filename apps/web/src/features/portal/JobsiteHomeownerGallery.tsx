'use client';

import { JobsiteHomeownerGallery as GallerySchema } from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { isApiError } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useApi } from '../../lib/session';
import { tokenFromHash } from '../jobs/customerStatus';

function GalleryImage({
  path,
  token,
  width,
  height,
}: {
  path: string;
  token: string;
  width: number;
  height: number;
}) {
  const [state, setState] = useState<{ key: string; image: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ visible: false, pass: 0 });
  const requestKey = path + ':' + token + ':' + attempt + ':' + viewport.pass;

  useEffect(() => {
    if (!frame.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setViewport((previous) =>
          previous.visible === entry.isIntersecting
            ? previous
            : {
                visible: entry.isIntersecting,
                pass: previous.pass + Number(entry.isIntersecting),
              },
        );
      },
      { rootMargin: '240px' },
    );
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!viewport.visible) return;
    const abort = new AbortController();
    let image: string | null = null;
    void (async () => {
      try {
        const response = await fetch(path, {
          method: 'POST',
          cache: 'no-store',
          credentials: 'omit',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
          signal: abort.signal,
        });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/png'))
          throw new Error('The shared photo is unavailable.');
        const bytes = await response.blob();
        if (abort.signal.aborted) return;
        image = URL.createObjectURL(bytes);
        setState({ key: requestKey, image });
      } catch {
        if (!abort.signal.aborted) setState({ key: requestKey, image: null });
      }
    })();
    return () => {
      abort.abort();
      if (image) URL.revokeObjectURL(image);
    };
  }, [path, requestKey, token, viewport.visible]);

  return (
    <div
      ref={frame}
      className="enterprise-homeowner-photo"
      style={{ aspectRatio: width + ' / ' + height }}
    >
      {viewport.visible &&
        (state?.key !== requestKey ? (
          <p role="status">Loading shared photo…</p>
        ) : !state.image ? (
          <p role="alert">
            This photo is unavailable.{' '}
            <button type="button" onClick={() => setAttempt(attempt + 1)}>
              Retry loading photo
            </button>
          </p>
        ) : (
          <Image
            unoptimized
            src={state.image}
            alt="Shared project photo"
            width={width}
            height={height}
            className="enterprise-photo-annotation-result"
          />
        ))}
    </div>
  );
}

export function JobsiteHomeownerGallery({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const read = () => setToken(tokenFromHash(window.location.hash));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const path = '/v1/portal/homeowner/projects/' + encodeURIComponent(projectId) + '/gallery';
  const gallery = useQuery({
    queryKey: ['portal', 'jobsite-gallery', projectId, token],
    queryFn: () => api.post(path, { token }, { schema: GallerySchema }),
    enabled: !!token,
    retry: (count, error) => count < 2 && !(isApiError(error) && error.status < 500),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });

  return (
    <main id="fl-main" className="js-public" tabIndex={-1}>
      <div className="js-public__card">
        {token === undefined || (token && gallery.isPending) ? (
          <p className="js-public__state" role="status">
            Loading shared project photos…
          </p>
        ) : !token || (isApiError(gallery.error) && [400, 404].includes(gallery.error.status)) ? (
          <div className="js-public__state" role="alert">
            <h1>This photo link is unavailable</h1>
            <p>Ask your project manager for a current gallery link.</p>
          </div>
        ) : gallery.isError ? (
          <div className="js-public__state" role="alert">
            <h1>Shared project photos could not load</h1>
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              onClick={() => void gallery.refetch()}
            >
              Try again
            </button>
          </div>
        ) : (
          gallery.data && (
            <>
              <header className="js-public__hero">
                <p className="js-eyebrow">{gallery.data.companyName}</p>
                <h1>Shared project photos</h1>
                <p>Gallery for {gallery.data.recipientName}</p>
              </header>
              <section className="js-public__updates" aria-label="Shared photos">
                {gallery.data.images.length === 0 && (
                  <p>No shared photos are currently available.</p>
                )}
                {gallery.data.images.map((image) => (
                  <figure key={image.id}>
                    <GalleryImage
                      path={path + '/images/' + image.id}
                      token={token}
                      width={image.width}
                      height={image.height}
                    />
                  </figure>
                ))}
              </section>
              <p className="web-muted web-small js-public__foot">
                Link expires {formatDate(gallery.data.expiresAt, 'en-US')}.
              </p>
            </>
          )
        )}
      </div>
    </main>
  );
}

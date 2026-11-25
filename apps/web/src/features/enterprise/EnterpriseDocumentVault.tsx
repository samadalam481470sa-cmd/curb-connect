'use client';

import {
  ENTERPRISE_DOCUMENT_MAX_BYTES,
  EnterpriseDocumentCategory,
  EnterpriseDocumentDecision,
  EnterpriseDocumentDetail,
  EnterpriseDocumentPage,
  EnterpriseDocumentVersion,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const categories = {
  plans: 'Plans and drawings',
  specifications: 'Specifications',
  contract: 'Contract documents',
  inspection: 'Inspections',
  other: 'Other',
} satisfies Record<z.infer<typeof EnterpriseDocumentCategory>, string>;

function message(error: unknown) {
  if (isApiError(error) || error instanceof Error) return error.message;
  return errorHint(error);
}

function readPdf(file: File): Promise<string> {
  if (file.size > ENTERPRISE_DOCUMENT_MAX_BYTES) throw new Error('Select a PDF of 8 MiB or less.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onabort = () => reject(new Error('File read was interrupted.'));
    reader.readAsDataURL(file);
  });
}

export function EnterpriseDocumentVault({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = [...orgKey(session.orgId, 'enterprise'), 'documents', projectId];
  const projectPath = '/v1/enterprise/projects/' + encodeURIComponent(projectId);
  const path = projectPath + '/documents';
  const [selectedId, setSelectedId] = useState('');
  const [addDocument, setAddDocument] = useState(false);
  const list = useInfiniteQuery({
    queryKey: [...key, 'list'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, { query: { cursor: pageParam }, schema: EnterpriseDocumentPage }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const detail = useQuery({
    queryKey: [...key, 'detail', selectedId],
    queryFn: () => api.get(path + '/' + selectedId, { schema: EnterpriseDocumentDetail }),
    enabled: selectedId.length > 0,
  });

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const legacy = list.data?.pages[0]?.legacyVersions ?? [];
  const document = detail.data?.document;
  const latest = detail.data?.versions[0];
  const canUpload = session.can('job:write');

  return (
    <section className="enterprise-panel">
      <header className="enterprise-control-head">
        <div>
          <h2>Document vault</h2>
          <p>
            Store project PDFs, retain earlier revisions, and record a decision on the current
            version.
          </p>
        </div>
        {canUpload && !addDocument && (
          <button type="button" onClick={() => setAddDocument(true)}>
            Add document
          </button>
        )}
      </header>
      {addDocument && (
        <VaultUploadForm
          path={path}
          onCancel={() => setAddDocument(false)}
          onSaved={async (version) => {
            setSelectedId(version.documentSetId ?? '');
            setAddDocument(false);
            await client.invalidateQueries({ queryKey: key });
          }}
        />
      )}
      {list.isPending && <p role="status">Loading documents…</p>}
      {list.isError && (
        <p role="alert" className="enterprise-error">
          {message(list.error)}
        </p>
      )}
      {list.isSuccess && !items.length && !legacy.length && (
        <p className="enterprise-empty">This project has no documents.</p>
      )}
      {!!items.length && (
        <div className="enterprise-vault-layout">
          <div>
            <ul className="enterprise-vault-index">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={selectedId === item.id}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <strong>{item.title}</strong>
                    <span>{categories[item.category]}</span>
                  </button>
                </li>
              ))}
            </ul>
            {list.hasNextPage && (
              <button
                type="button"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                Load more documents
              </button>
            )}
          </div>
          <div>
            {!selectedId && (
              <p className="enterprise-empty">Select a document to see its versions.</p>
            )}
            {selectedId && detail.isPending && <p role="status">Loading versions…</p>}
            {detail.isError && (
              <p role="alert" className="enterprise-error">
                {message(detail.error)}
              </p>
            )}
            {document && latest && (
              <>
                <h3>{document.title}</h3>
                {canUpload && (
                  <details key={latest.id}>
                    <summary>Upload a new version</summary>
                    <VaultUploadForm
                      path={path + '/' + document.id + '/versions'}
                      previousVersion={latest.version}
                      onSaved={() => client.invalidateQueries({ queryKey: key })}
                    />
                  </details>
                )}
                <ol className="enterprise-change-history" aria-label="Document version history">
                  {detail.data?.versions.map((version) => (
                    <li key={version.id}>
                      <VaultVersion version={version} projectPath={projectPath} />
                      {version.id === latest.id &&
                        !version.review &&
                        session.can('review_task:decide') && (
                          <VaultReview
                            key={version.id}
                            path={projectPath + '/document-versions/' + version.id + '/review'}
                            onSaved={() => client.invalidateQueries({ queryKey: key })}
                          />
                        )}
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        </div>
      )}
      {!!legacy.length && (
        <section>
          <h3>Previously registered files</h3>
          <ul className="enterprise-change-history">
            {legacy.map((version) => (
              <li key={version.id}>
                <VaultVersion version={version} projectPath={projectPath} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function VaultVersion({
  version,
  projectPath,
}: {
  version: EnterpriseDocumentVersion;
  projectPath: string;
}) {
  const href = projectPath + '/document-versions/' + version.id + '/download';
  return (
    <div>
      <strong>
        Version {version.version} · {version.filename}
      </strong>
      <p>
        <time dateTime={version.createdAt}>{version.createdAt.slice(0, 10)}</time>
        {' · '}
        {Math.max(1, Math.ceil(version.byteSize / 1024))} KiB
        {' · '}
        {version.scanStatus === 'clean' ? 'Scan passed' : 'Awaiting scanner configuration'}
      </p>
      {version.revisionNote && <p>{version.revisionNote}</p>}
      {version.review && (
        <p>
          <strong>
            {version.review.decision === 'approved' ? 'Approved' : 'Changes requested'}
          </strong>{' '}
          · {version.review.note}
        </p>
      )}
      <a className="enterprise-back" href={href} download>
        Download version {version.version}
      </a>
    </div>
  );
}

function VaultUploadForm({
  path,
  previousVersion,
  onSaved,
  onCancel,
}: {
  path: string;
  previousVersion?: number;
  onSaved: (version: EnterpriseDocumentVersion) => Promise<void>;
  onCancel?: () => void;
}) {
  const { api } = useApi();
  const request = useRef<{ file: File; signature: string; id: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const replacing = previousVersion !== undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError('');
    setBusy(true);
    try {
      const data = new FormData(form);
      const file = data.get('file');
      if (!(file instanceof File) || !file.size) throw new Error('Choose a PDF file.');
      const revisionNote = String(data.get('revisionNote') ?? '').trim() || undefined;
      const destination = replacing
        ? {}
        : {
            title: String(data.get('title') ?? '').trim(),
            category: data.get('category'),
          };
      const signature = JSON.stringify({ ...destination, revisionNote });
      if (request.current?.file !== file || request.current.signature !== signature)
        request.current = { file, signature, id: crypto.randomUUID() };
      const created = await api.post(
        path,
        {
          ...destination,
          revisionNote,
          filename: file.name,
          contentBase64: await readPdf(file),
          clientRequestId: request.current.id,
        },
        { schema: EnterpriseDocumentVersion, ifMatch: previousVersion },
      );
      await onSaved(created);
      request.current = null;
      form.reset();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="enterprise-form enterprise-task-form" onSubmit={(event) => void submit(event)}>
      {!replacing && (
        <>
          <label>
            Document title <input name="title" required minLength={2} maxLength={180} />
          </label>
          <label>
            Category
            <select name="category">
              {EnterpriseDocumentCategory.options.map((category) => (
                <option key={category} value={category}>
                  {categories[category]}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label>
        PDF file (up to 8 MiB){' '}
        <input name="file" type="file" accept="application/pdf,.pdf" required />
      </label>
      <label>
        Revision note{' '}
        <input name="revisionNote" required={replacing} minLength={3} maxLength={1000} />
      </label>
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
      <div className="enterprise-actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Uploading…' : replacing ? 'Save new version' : 'Upload PDF'}
        </button>
        {onCancel && (
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function VaultReview({ path, onSaved }: { path: string; onSaved: () => Promise<void> }) {
  const { api } = useApi();
  const review = useMutation({
    mutationFn: (data: { note: string; decision: z.infer<typeof EnterpriseDocumentDecision> }) =>
      api.post(path, data, { schema: EnterpriseDocumentVersion }),
    onSuccess: onSaved,
  });
  return (
    <form
      className="enterprise-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const decision = EnterpriseDocumentDecision.parse(data.get('decision'));
        review.mutate({ decision, note: String(data.get('note') ?? '') });
      }}
    >
      <label>
        Review decision
        <select name="decision">
          <option value="approved">Approve</option>
          <option value="changes_requested">Request changes</option>
        </select>
      </label>
      <label>
        Review note <input name="note" required minLength={3} maxLength={1000} />
      </label>
      {review.isError && (
        <p role="alert" className="enterprise-error">
          {message(review.error)}
        </p>
      )}
      <button type="submit" disabled={review.isPending}>
        {review.isPending ? 'Recording…' : 'Record review decision'}
      </button>
    </form>
  );
}

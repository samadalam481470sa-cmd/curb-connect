'use client';

import { ContractorEvidenceReceipt, ContractorEvidenceTask } from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@fieldline/ui';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { EvidenceSubmissionEditor } from '../enterprise/JobsiteEvidencePanel';

export function ContractorEvidenceForm({
  path,
  onCancel,
  onSubmitted,
}: {
  path: string;
  onCancel: () => void;
  onSubmitted: (revision: number) => void;
}) {
  const { api } = useApi();
  const { me, orgId } = useSession();
  const scope = useQuery({
    queryKey: orgKey(orgId, 'contractor-evidence', me.user.id, path),
    queryFn: () => api.get(path, { schema: ContractorEvidenceTask }),
    refetchOnMount: 'always',
    refetchInterval: (query) =>
      query.state.data?.candidates.some((item) => item.availability === 'pending') ? 4000 : false,
  });
  const noAccess = isApiError(scope.error) && [401, 403, 404].includes(scope.error.status);

  return (
    <>
      {scope.isPending && <Skeleton variant="card" label="Loading linked evidence" />}
      {scope.isError && (
        <div role="alert">
          <p>{noAccess ? 'Task evidence is unavailable.' : errorHint(scope.error)}</p>
          {!noAccess && isApiError(scope.error) && (
            <p>Support reference {scope.error.correlationId}</p>
          )}
          {!noAccess && (
            <button type="button" onClick={() => void scope.refetch()}>
              Retry evidence
            </button>
          )}
        </div>
      )}
      {scope.isSuccess && (
        <EvidenceSubmissionEditor
          canSubmit={scope.data.canSubmit}
          candidates={scope.data.candidates}
          minimum={scope.data.minimumMedia}
          revision={scope.data.revision}
          saveSubmission={(input, revision) =>
            api.post(path + '/submissions', input, {
              ifMatch: revision,
              schema: ContractorEvidenceReceipt,
            })
          }
          onSaved={({ revision }) => onSubmitted(revision)}
          reload={() => void scope.refetch()}
        />
      )}
      <button type="button" onClick={onCancel}>
        Close evidence
      </button>
    </>
  );
}

import { errorHint, isApiError } from '../../lib/api';

export function takeoffAccessDenied(error: unknown) {
  return isApiError(error) && (error.status === 403 || error.status === 404);
}

export function TakeoffResourceError({
  error,
  unavailable,
  retry,
  retryLabel,
}: {
  error: unknown;
  unavailable: string;
  retry: () => void;
  retryLabel: string;
}) {
  if (takeoffAccessDenied(error)) return <p role="alert">{unavailable}</p>;

  return (
    <div>
      <p role="alert" className="enterprise-error">
        {errorHint(error)}
      </p>
      {isApiError(error) && <p>Reference {error.correlationId}</p>}
      <button type="button" onClick={retry}>
        {retryLabel}
      </button>
    </div>
  );
}

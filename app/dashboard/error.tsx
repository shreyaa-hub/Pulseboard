'use client';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="dash">
      <div className="error-panel">
        <h2>The dashboard hit an error</h2>
        <p>{error.message || 'Something went wrong loading the sensor feed.'}</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}

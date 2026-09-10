export default function DashboardLoading() {
  return (
    <div className="dash">
      <div className="skeleton-bar" style={{ height: 68 }} />
      <div className="dash-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton-bar" style={{ height: 240 }} />
        ))}
      </div>
    </div>
  );
}

const StatusBadge = ({ tone = "info", children, className = "" }) => {
  return (
    <span className={`theme-status-badge theme-status-badge--${tone} ${className}`.trim()}>
      {children}
    </span>
  );
};

export default StatusBadge;

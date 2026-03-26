const GazeMonitor = ({ enabled = true }) => {
  if (!enabled) return null;

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1.5">
        <div className="h-1.5 w-1.5 rounded-full bg-gray-500" />
        <p className="text-gray-500 text-xs">
          Gaze: Backend analysis only
        </p>
      </div>
    </div>
  );
};

export default GazeMonitor;

const VIEWBOX = "0 0 100 100";

/**
 * Keyhole-in-circle mark. The original Stash logo shipped a complex traced path;
 * this is a clean geometric equivalent (filled disc with a keyhole knocked out
 * via the even-odd fill rule) that scales identically and uses currentColor.
 */
export default function StashLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox={VIEWBOX}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      fill="currentColor"
      aria-hidden
      overflow="visible"
      style={{ display: "block", width: "100%", height: "100%" }}
    >
      <path
        fillRule="evenodd"
        d="M50 2C23.49 2 2 23.49 2 50s21.49 48 48 48 48-21.49 48-48S76.51 2 50 2zm0 26a12 12 0 0 1 5.5 22.66L60 74H40l4.5-23.34A12 12 0 0 1 50 28z"
      />
    </svg>
  );
}

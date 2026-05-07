export default function SawatchFooter() {
  return (
    <div
      className="fixed bottom-0 left-0 w-full pointer-events-none"
      style={{ height: '80px', zIndex: 0 }}
    >
      <svg
        viewBox="0 0 1440 80"
        preserveAspectRatio="none"
        className="w-full h-full"
        aria-hidden="true"
      >
        {/* Mountain silhouette fill */}
        <path
          d="M0 80 L0 58 L60 42 L120 52 L180 35 L240 45 L300 28 L360 38 L420 22 L480 32 L540 18 L600 25 L660 15 L720 20 L780 12 L840 18 L900 22 L960 16 L1020 24 L1080 20 L1140 30 L1200 25 L1260 35 L1320 28 L1380 40 L1440 34 L1440 80 Z"
          fill="var(--color-bg-elevated)"
        />
        {/* Dawn-gold ridge highlight — top edge only */}
        <path
          d="M0 58 L60 42 L120 52 L180 35 L240 45 L300 28 L360 38 L420 22 L480 32 L540 18 L600 25 L660 15 L720 20 L780 12 L840 18 L900 22 L960 16 L1020 24 L1080 20 L1140 30 L1200 25 L1260 35 L1320 28 L1380 40 L1440 34"
          fill="none"
          stroke="var(--color-dawn-gold)"
          strokeWidth="1"
          strokeOpacity="0.3"
        />
      </svg>
    </div>
  );
}

// Pétalos que caen: animación CSS pura (sin JS), determinista para evitar desajustes de hidratación.
const PETALS = Array.from({ length: 16 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  size: 14 + ((i * 13) % 22),
  delay: -((i * 1.7) % 14),
  dur: 11 + ((i * 5) % 9),
  sway: 20 + ((i * 11) % 50),
  tone: i % 3,
}));

export default function Petals() {
  return (
    <div className="petals" aria-hidden="true">
      {PETALS.map((p, i) => (
        <span
          key={i}
          className={`petal petal--${p.tone}`}
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.size * 1.35,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
              ["--sway" as string]: `${p.sway}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

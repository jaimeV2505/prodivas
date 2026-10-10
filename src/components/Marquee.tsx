/** Cinta de servicios en bucle infinito (CSS). Decorativa. */
export default function Marquee({ items }: { items: string[] }) {
  return (
    <div className="marquee-wrap" aria-hidden="true">
    <div className="marquee">
      <div className="marquee__track">
        {[0, 1].map((k) => (
          <ul className="marquee__row" key={k}>
            {items.map((t) => (
              <li key={t}>
                <span>{t}</span>
                <i className="marquee__petal" />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
    </div>
  );
}

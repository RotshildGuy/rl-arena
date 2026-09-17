/**
 * The five-light gantry.
 *
 * Lights come on one a second and the race starts the instant they go out —
 * which is why the last second before a start is the one everybody watches. It
 * is also a countdown you can read without reading, at any size.
 */
export function StartLights({ secondsLeft }: { secondsLeft: number }) {
  const lit = Math.max(0, Math.min(5, 5 - Math.ceil(secondsLeft - 0.0001)));
  return (
    <div className="lights" aria-label={`${Math.ceil(secondsLeft)} שניות לזינוק`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div className="col" key={i}>
          <div className={`bulb ${i < lit ? 'on' : ''}`} />
          <div className={`bulb ${i < lit ? 'on' : ''}`} />
        </div>
      ))}
    </div>
  );
}

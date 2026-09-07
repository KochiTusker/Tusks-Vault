import { useMemo } from "react";

// The astrolabe — Vault's ambient background. A working instrument behind
// the page rather than decoration: a graduated scale, a ring of runes, a
// hexagram, all turning at different speeds, the slowest taking over four
// minutes for one revolution. You notice it only if you look for it.
//
// It replaced a hearth-and-embers stage. The reason is worth keeping: that
// stage put an animated fire, drifting sparks and floating motes all in the
// SAME warm hue as the page itself, so the motion registered as smear
// rather than atmosphere. This leans on the amethyst counter-note the
// palette already carries (see docs/design-system.md) — arcane geometry in
// ember and amethyst over warm umber, so what moves actually reads.
//
// Geometry is generated rather than hand-authored so the graduations and
// glyph placement stay exact; useMemo means it is built once per mount.
// Everything is pointer-events:none and aria-hidden, and every rotation is
// stopped under prefers-reduced-motion (index.css).

const EMBER = "var(--color-ember)";
const ARCANE = "var(--color-arcane)";

// Angular marks set around the rune ring. Deliberately geometric rather
// than any real alphabet — they read as notation without claiming to be a
// language anyone could try to translate.
const GLYPHS = [
  "M0 -6 L0 6 M-4 -3 L4 -6",
  "M-4 -6 L0 6 L4 -6",
  "M0 -6 L0 6 M-4 6 L4 -2",
  "M-4 -6 L-4 6 L4 0 Z",
  "M0 -6 L0 6 M-4 0 L4 0",
  "M-4 -6 L4 6 M4 -6 L-4 6",
  "M-4 -6 L0 0 L-4 6 M4 -6 L4 6",
  "M0 -6 L4 0 L0 6 L-4 0 Z",
];

const C = 200; // viewBox centre

export function Astrolabe() {
  const { ticks, runes, hexPoints } = useMemo(() => {
    // 72 graduations, every sixth one long — an instrument scale, not a
    // dashed circle.
    const ticks = Array.from({ length: 72 }, (_, i) => {
      const a = (i / 72) * Math.PI * 2;
      const long = i % 6 === 0;
      const r0 = 150;
      const r1 = long ? 164 : 158;
      return {
        key: i,
        x1: C + Math.cos(a) * r0,
        y1: C + Math.sin(a) * r0,
        x2: C + Math.cos(a) * r1,
        y2: C + Math.sin(a) * r1,
        long,
      };
    });

    const runes = Array.from({ length: 16 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      const r = 128;
      return {
        key: i,
        transform: `translate(${C + Math.cos(a) * r} ${C + Math.sin(a) * r}) rotate(${(a * 180) / Math.PI + 90})`,
        d: GLYPHS[i % GLYPHS.length],
        cool: i % 2 === 1,
      };
    });

    // Two opposed triangles — a hexagram drawn as two polygons rather than
    // one self-intersecting path, so the stroke joins stay clean.
    const tri = (rot: number) =>
      Array.from({ length: 3 }, (_, i) => {
        const a = (i / 3) * Math.PI * 2 + rot;
        return `${C + Math.cos(a) * 96},${C + Math.sin(a) * 96}`;
      }).join(" ");

    return { ticks, runes, hexPoints: [tri(-Math.PI / 2), tri(Math.PI / 2)] };
  }, []);

  return (
    <svg
      className="astrolabe"
      viewBox="0 0 400 400"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      {/* Outer bounds — one solid rim, one dashed */}
      <g className="astro-ring astro-r1" opacity="0.20">
        <circle cx={C} cy={C} r={186} stroke={EMBER} strokeWidth={0.7} fill="none" />
      </g>
      <g className="astro-ring astro-r3" opacity="0.16">
        <circle cx={C} cy={C} r={176} stroke={EMBER} strokeWidth={0.5} fill="none" strokeDasharray="2 7" />
      </g>

      {/* Graduated scale */}
      <g className="astro-ring astro-r2" opacity="0.15">
        {ticks.map(t => (
          <line
            key={t.key}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={t.long ? EMBER : ARCANE}
            strokeWidth={t.long ? 1 : 0.5}
          />
        ))}
      </g>

      {/* Rune ring — counter-rotating against the scale */}
      <g className="astro-ring astro-r4" opacity="0.17">
        {runes.map(r => (
          <g key={r.key} transform={r.transform}>
            <path d={r.d} stroke={r.cool ? ARCANE : EMBER} strokeWidth={1.1} fill="none" strokeLinecap="round" />
          </g>
        ))}
      </g>

      {/* Inner geometry — hexagram + hub */}
      <g className="astro-ring astro-r1" opacity="0.15">
        {hexPoints.map((points, i) => (
          <polygon key={i} points={points} stroke={ARCANE} strokeWidth={0.7} fill="none" />
        ))}
        <circle cx={C} cy={C} r={52} stroke={EMBER} strokeWidth={0.6} fill="none" />
      </g>
    </svg>
  );
}

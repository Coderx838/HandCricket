// hand.js -- the helper for the interpreting on the hands


const Hands = (() => {
  // deterministic tiny noise so a count always looks the same
  function seeded(seed) {
    let s = seed * 9301 + 49297;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  /* one finger drawn as a rounded capsule path from (x,y) upward length L */
  function fingerPath(x, y, L, w, curl = 0) {
    const half = w / 2;
    if (curl > 0.5) {
      // folded: short stub curling toward palm
      const r = half;
      return [
        `M ${x - half} ${y}`,
        `L ${x - half} ${y - L * 0.25}`,
        `Q ${x - half} ${y - L * 0.45} ${x} ${y - L * 0.45}`,
        `Q ${x + half} ${y - L * 0.45} ${x + half} ${y - L * 0.25}`,
        `L ${x + half} ${y}`,
      ].join(" ");
    }
    return [
      `M ${x - half} ${y}`,
      `L ${x - half} ${y - L + w * 0.5}`,
      `Q ${x - half} ${y - L} ${x} ${y - L}`,
      `Q ${x + half} ${y - L} ${x + half} ${y - L + w * 0.5}`,
      `L ${x + half} ${y}`,
    ].join(" ");
  }

  /* thumb pointing out to the side */
  function thumbPath(x, y, dir, L, w) {
    const half = w / 2;
    const dx = dir * L;
    return [
      `M ${x} ${y - half}`,
      `Q ${x + dx * 0.45} ${y - half - L * 0.15} ${x + dx * 0.75} ${y - L * 0.35}`,
      `Q ${x + dx} ${y - L * 0.55} ${x + dx * 0.95} ${y - L * 0.15}`,
      `Q ${x + dx * 0.7} ${y + half} ${x} ${y + half}`,
    ].join(" ");
  }

  /* palm blob */
  function palmPath(cx, cy, w, h) {
    const l = cx - w / 2;
    const r = cx + w / 2;
    const t = cy - h / 2;
    const b = cy + h / 2;
    return [
      `M ${l + w * 0.08} ${t}`,
      `Q ${cx} ${t - h * 0.08} ${r - w * 0.08} ${t + h * 0.06}`,
      `Q ${r + w * 0.06} ${cy} ${r - w * 0.04} ${b - h * 0.15}`,
      `Q ${cx} ${b + h * 0.1} ${l + w * 0.04} ${b - h * 0.12}`,
      `Q ${l - w * 0.06} ${cy} ${l + w * 0.08} ${t}`,
      "Z",
    ].join(" ");
  }

  /**
   * Build hand SVG for a finger count.
   * 1–4: that many fingers up (index→pinky order)
   * 5: four fingers + thumb out
   * 6: full open palm with all 5 digits (thumb out, fingers spread)
*/
  function svg(count, opts = {}) {
    count = Math.max(1, Math.min(6, count | 0));
    const size = opts.size || 140;
    const rnd = seeded(count * 17 + 3);
    const j = () => (rnd() - 0.5) * 2.2; // wobble jitter

    // finger base x positions along knuckle line
    const cx = 70;
    const palmW = 78;
    const palmH = 62;
    const palmCy = 100;
    const knuckleY = palmCy - palmH * 0.42;

    const fingers = [
      { x: cx - 24, L: 52, w: 15 }, // index
      { x: cx - 8,  L: 60, w: 15 }, // middle
      { x: cx + 8,  L: 56, w: 15 }, // ring
      { x: cx + 24, L: 46, w: 14 }, // pinky
    ];

    // how many fingers stand up
    let upCount;
    let thumbOut = false;
    if (count <= 4) upCount = count;
    else upCount = 4; // 5 & 6 use all four + thumb
    if (count >= 5) thumbOut = true;

    // spread factor for "six" (open hand)
    const spread = count === 6 ? 1.35 : count === 5 ? 1.1 : 1;

    let parts = [];

    // folded fingers first (behind)
    for (let i = upCount; i < 4; i++) {
      const f = fingers[i];
      const d = fingerPath(f.x + j(), knuckleY + 4, f.L, f.w, 1);
      parts.push(`<path class="hand-fold" d="${d}"/>`);
    }

    // thumb
    if (thumbOut) {
      const tx = cx - palmW * 0.42;
      const ty = palmCy - 4;
      const dir = -1;
      const L = count === 6 ? 40 : 36;
      const d = thumbPath(tx + j(), ty + j(), dir, L, 17);
      parts.push(`<path class="hand-thumb" d="${d}"/>`);
    } else if (count <= 4) {
      // thumb tucked across palm
      const tx = cx - palmW * 0.3;
      const ty = palmCy + 8;
      parts.push(
        `<path class="hand-thumb-tuck" d="M ${tx} ${ty} Q ${tx - 8} ${ty - 14} ${tx + 14} ${ty - 18} Q ${tx + 30} ${ty - 20} ${tx + 34} ${ty - 6}"/>`
      );
    }

    // palm
    parts.push(`<path class="hand-palm" d="${palmPath(cx + j() * 0.4, palmCy, palmW, palmH)}"/>`);

    // upright fingers — spread outward slightly for open-hand six
    for (let i = 0; i < upCount; i++) {
      const f = fingers[i];
      const mid = (i - 1.5) / 1.5; // -1..1 for lean
      const lean = mid * (spread - 1) * 18;
      const x = f.x + lean + j();
      const L = f.L * (count === 6 ? 1.05 : 1) + j();
      const d = fingerPath(x, knuckleY + 2, L, f.w, 0);
      parts.push(`<path class="hand-finger" d="${d}"/>`);
      // knuckle crease
      parts.push(
        `<path class="hand-crease" d="M ${x - f.w * 0.3} ${knuckleY + 10} Q ${x} ${knuckleY + 13} ${x + f.w * 0.3} ${knuckleY + 10}"/>`
      );
    }

    // wrist
    parts.push(
      `<path class="hand-wrist" d="M ${cx - 26} ${palmCy + 28} Q ${cx} ${palmCy + 38} ${cx + 26} ${palmCy + 28} L ${cx + 24} ${palmCy + 44} Q ${cx} ${palmCy + 52} ${cx - 24} ${palmCy + 44} Z"/>`
    );

    // six sparkles
    if (count === 6) {
      parts.push(`<path class="hand-spark" d="M 22 28 l 0 12 M 16 34 l 12 0"/>`);
      parts.push(`<path class="hand-spark" d="M 112 40 l 0 10 M 107 45 l 10 0"/>`);
      parts.push(`<path class="hand-spark" d="M 100 18 l 0 8 M 96 22 l 8 0"/>`);
    }

    return `<svg class="hand-svg hand-n${count}" viewBox="0 0 140 160" width="${size}" height="${(size * 160) / 140}" xmlns="http://www.w3.org/2000/svg" filter="url(#wobble-soft)" aria-label="showing ${count}">
      <g filter="url(#wobble)">${parts.join("\n")}</g>
    </svg>`;
  }

  /* tiny hand used inside the 1–6 buttons */
  function mini(count) {
    return svg(count, { size: 36 });
  }

  return { svg, mini };
})();

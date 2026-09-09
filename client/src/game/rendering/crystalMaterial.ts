/** Baked once per surface size, not redrawn in the gameplay update loop. */
export function paintCrystalMaterial(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const bevel = Math.min(7, width / 5, height / 5);
  const polygon = (points: number[], fill: string | CanvasGradient): void => {
    ctx.beginPath();
    ctx.moveTo(points[0]!, points[1]!);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  ctx.clearRect(0, 0, width, height);
  const body = ctx.createLinearGradient(0, 0, width * 0.25, height);
  body.addColorStop(0, "rgba(196,248,255,0.94)");
  body.addColorStop(0.16, "rgba(72,189,227,0.86)");
  body.addColorStop(0.42, "rgba(19,106,167,0.83)");
  body.addColorStop(0.66, "rgba(57,162,211,0.84)");
  body.addColorStop(1, "rgba(6,47,103,0.96)");
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, width, height);

  // Screen-space facets retain their proportions on narrow floors and tall walls.
  ctx.save();
  ctx.beginPath();
  ctx.rect(bevel, bevel, width - bevel * 2, height - bevel * 2);
  ctx.clip();
  for (let y = 0, row = 0; y < height; y += 92, row++) {
    for (let x = -65; x < width; x += 105) {
      const xx = x + (row % 2) * 42;
      const tip = y + 33 + ((x + row * 17 + 420) % 31);
      polygon([xx, y, xx + 102, y + 8, xx + 43, tip], "rgba(204,251,255,0.16)");
      polygon([xx + 43, tip, xx + 102, y + 8, xx + 85, y + 98], "rgba(2,49,103,0.22)");
      polygon([xx, y, xx + 43, tip, xx + 10, y + 92], "rgba(111,222,251,0.10)");
      ctx.strokeStyle = "rgba(210,253,255,0.26)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(xx + 102, y + 8);
      ctx.lineTo(xx + 43, tip);
      ctx.lineTo(xx + 10, y + 92);
      ctx.stroke();
    }
  }

  // Broad reflected light bands and fine caustics suggest depth, without flicker.
  for (let x = -height; x < width + height; x += 240) {
    const reflection = ctx.createLinearGradient(x, 0, x + 72, 0);
    reflection.addColorStop(0, "rgba(220,255,255,0)");
    reflection.addColorStop(0.47, "rgba(224,255,255,0.25)");
    reflection.addColorStop(0.5, "rgba(255,255,255,0.48)");
    reflection.addColorStop(1, "rgba(210,250,255,0)");
    polygon([x, 0, x + 72, 0, x + 72 - height * 0.42, height, x - height * 0.42, height], reflection);
  }
  ctx.restore();

  polygon([0, 0, width, 0, width - bevel, bevel, bevel, bevel], "rgba(227,255,255,0.92)");
  polygon([0, 0, bevel, bevel, bevel, height - bevel, 0, height], "rgba(153,238,255,0.76)");
  polygon([width, 0, width, height, width - bevel, height - bevel, width - bevel, bevel], "rgba(9,58,112,0.73)");
  polygon([0, height, bevel, height - bevel, width - bevel, height - bevel, width, height], "rgba(2,28,70,0.83)");
  ctx.strokeStyle = "rgba(198,250,255,0.85)";
  ctx.lineWidth = 1;
  ctx.strokeRect(bevel + 0.5, bevel + 0.5, Math.max(0, width - bevel * 2 - 1), Math.max(0, height - bevel * 2 - 1));
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.fillRect(1, 0, Math.max(0, width - 2), Math.min(1.5, height));
}

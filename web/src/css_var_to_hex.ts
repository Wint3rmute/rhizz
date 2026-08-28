function linearToSRGB(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function oklchToHex(str: string): string {
  const m = str.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!m) return "#000000";
  const L = parseFloat(m[1] ?? "");
  const C = parseFloat(m[2] ?? "");
  const H = parseFloat(m[3] ?? "") * (Math.PI / 180);

  // oklch -> oklab
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);

  // oklab -> linear sRGB
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, lm = m_ ** 3, ls = s_ ** 3;
  const rLin = 4.0767416621 * l - 3.3077115913 * lm + 0.2309699292 * ls;
  const gLin = -1.2684380046 * l + 2.6097574011 * lm - 0.3413193965 * ls;
  const bLin = -0.0041960863 * l - 0.7034186147 * lm + 1.7076147010 * ls;

  const toU8 = (c: number) =>
    Math.round(Math.min(1, Math.max(0, linearToSRGB(c))) * 255);
  return "#" + [rLin, gLin, bLin]
    .map((c) => toU8(c).toString(16).padStart(2, "0"))
    .join("");
}

function rgbToHex(str: string): string {
  const parts = str.match(/\d+/g) ?? [];
  const r = Number(parts[0] ?? 0);
  const g = Number(parts[1] ?? 0);
  const b = Number(parts[2] ?? 0);
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

export function cssVarToHex(varName: string): string {
  const el = document.createElement("div");
  el.style.color = `var(${varName})`;
  document.body.appendChild(el);
  const computed = getComputedStyle(el).color;
  document.body.removeChild(el);
  return computed.startsWith("oklch")
    ? oklchToHex(computed)
    : rgbToHex(computed);
}

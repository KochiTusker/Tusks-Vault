// Tiny class-name combiner — the shadcn `cn()` contract without the clsx +
// tailwind-merge dependencies. Accepts strings and falsy values; later
// classes win by CSS order, which is all this codebase needs (no dynamic
// conflicting-utility merging happens here).
export type ClassValue = string | number | null | false | undefined;

export function cn(...inputs: ClassValue[]): string {
  return inputs.filter(Boolean).join(" ");
}

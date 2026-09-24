import type { CSSProperties } from "react";

const paths = {
  home: "M3 11l9-7 9 7 M5 10v10h14V10 M10 20v-6h4v6",
  plus: "M12 5v14 M5 12h14",
  list: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  back: "M19 12H5 M11 18l-6-6 6-6",
  check: "M5 12l4 4L19 6",
  close: "M6 6l12 12 M6 18L18 6",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  download: "M12 3v12 M7 10l5 5 5-5 M5 16v5h14v-5",
  refresh: "M21 12a9 9 0 1 1-3-6.7L21 8 M21 3v5h-5",
  stop: "M6 6h12v12H6z",
  copy: "M9 9h11v11H9z M5 15H4V4h11v1",
  external: "M14 3h7v7 M10 14L21 3 M19 14v6H4V5h6",
  alert: "M12 9v4 M12 17h.01 M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  info: "M12 16v-4 M12 8h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
  building: "M4 21V5l8-3v19 M12 8h8v13 M8 9h.01 M8 13h.01 M8 17h.01 M16 12h.01 M16 16h.01 M2 21h20",
  mail: "M4 5h16v14H4z M4 7l8 6 8-6",
  edit: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  undo: "M9 14L4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3",
  clock: "M12 7v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  repeat: "M17 2l4 4-4 4 M3 11V9a3 3 0 0 1 3-3h15 M7 22l-4-4 4-4 M21 13v2a3 3 0 0 1-3 3H3",
  swap: "M7 16V4 M3 8l4-4 4 4 M17 8v12 M21 16l-4 4-4-4",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18, style, className }: { name: IconName; size?: number; style?: CSSProperties; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}

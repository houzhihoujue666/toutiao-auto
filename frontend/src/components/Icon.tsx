/** 图标：直接引用 index.html 里的 SVG sprite（与 demo 同一套图形） */
export function Icon({
  name,
  className = 'ico',
}: {
  name: string;
  className?: string;
}): React.ReactNode {
  return (
    <svg className={className} aria-hidden="true" focusable="false">
      <use href={`#${name}`} />
    </svg>
  );
}

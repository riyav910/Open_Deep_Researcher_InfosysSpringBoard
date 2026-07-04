import { Compass } from "lucide-react";

export function LangGraphLogoSVG({
  className,
  width,
  height,
}: {
  width?: number;
  height?: number;
  className?: string;
}) {
  return (
    <Compass
      className={`stroke-[1.8] text-primary ${className || ""}`}
      width={width}
      height={height}
    />
  );
}

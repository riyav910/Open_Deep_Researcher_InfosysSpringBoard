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
    <img
      src="/logo.png"
      alt="Research & Planning Logo"
      className={className}
      style={{
        width: width ?? undefined,
        height: height ?? undefined,
        objectFit: "contain",
      }}
    />
  );
}

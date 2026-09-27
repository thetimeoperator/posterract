import { useState } from "react";
import clsx from "clsx";

/** A business's small round logo, or its initials when it has none. */
export function BusinessLogo({ name, logoUrl, size = 16, className }: {
  name: string;
  logoUrl?: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string>();
  const initials = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "?";
  return (
    <span
      title={name}
      aria-label={name}
      role="img"
      className={clsx("inline-flex flex-none items-center justify-center overflow-hidden rounded-full border border-white/[0.16] bg-neon/[0.14] font-display font-semibold text-neon", className)}
      style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.42)) }}
    >
      {logoUrl && failed !== logoUrl
        ? <img src={logoUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={() => setFailed(logoUrl)} />
        : initials}
    </span>
  );
}

/** Shrinks a chosen picture to a 128 px square (centre crop) as a data URL, small enough to store. */
export async function logoDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("That picture couldn't be read."));
      element.src = url;
    });
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("That picture couldn't be read.");
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 128, 128);
    const webp = canvas.toDataURL("image/webp", 0.9);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

"use client";

import Image from "next/image";
import { useState } from "react";

interface LogoImageProps {
  height?: number;  // px, width is auto from image aspect ratio
}

export function LogoImage({ height = 32 }: LogoImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-lg bg-brand px-2 font-mono text-xs font-bold text-white"
        style={{ height }}
      >
        K
      </span>
    );
  }

  return (
    <Image
      src="/kado-logo.png"
      alt="Kado"
      height={height}
      width={0}
      style={{ width: "auto", height }}
      className="object-contain"
      onError={() => setFailed(true)}
      priority
      sizes="200px"
    />
  );
}

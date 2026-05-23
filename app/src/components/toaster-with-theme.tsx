"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

export function ToasterWithTheme() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const update = () => setDark(document.documentElement.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <Toaster
      theme={dark ? "dark" : "light"}
      position="bottom-right"
      toastOptions={{
        style: dark
          ? { background: "#1C1C18", border: "1px solid #2C2C26", color: "#F0EBE0" }
          : { background: "#FAFAF7", border: "1px solid #E0D9CE", color: "#1A1A1A" },
      }}
    />
  );
}

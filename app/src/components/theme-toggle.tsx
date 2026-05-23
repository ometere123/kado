"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("kado_theme", next ? "dark" : "light"); } catch {}
  }

  return (
    <button
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface transition hover:bg-brand-wash"
    >
      {dark ? (
        <Sun className="h-4 w-4" style={{ color: "#E9C46A" }} />
      ) : (
        <Moon className="h-4 w-4" style={{ color: "#A8B4C8" }} />
      )}
    </button>
  );
}

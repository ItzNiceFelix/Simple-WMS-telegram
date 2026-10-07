"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

type Tema = "terang" | "gelap";

function terapkanTema(t: Tema) {
  const root = document.documentElement;
  root.classList.toggle("dark", t === "gelap");
}

export function ThemeToggle() {
  const [tema, setTema] = useState<Tema>("terang");

  useEffect(() => {
    const tersimpan = window.localStorage.getItem("tema") as Tema | null;
    if (tersimpan === "terang" || tersimpan === "gelap") {
      setTema(tersimpan);
      terapkanTema(tersimpan);
      return;
    }
    const sukaGelap = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const awal: Tema = sukaGelap ? "gelap" : "terang";
    setTema(awal);
    terapkanTema(awal);
  }, []);

  function ganti() {
    const baru: Tema = tema === "gelap" ? "terang" : "gelap";
    setTema(baru);
    terapkanTema(baru);
    window.localStorage.setItem("tema", baru);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11 md:size-8"
      onClick={ganti}
      aria-label={tema === "gelap" ? "Ganti ke mode terang" : "Ganti ke mode gelap"}
      title={tema === "gelap" ? "Mode terang" : "Mode gelap"}
    >
      {tema === "gelap" ? <Sun /> : <Moon />}
    </Button>
  );
}

"use client";

import { useState } from "react";

export default function OptoutButton({ token, label, done, error }: { token: string; label: string; done: string; error: string }) {
  const [s, setS] = useState<"idle" | "busy" | "ok" | "err">("idle");
  async function go() {
    setS("busy");
    try {
      const r = await fetch("/api/optout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      setS(r.ok ? "ok" : "err");
    } catch {
      setS("err");
    }
  }
  if (s === "ok") return <p className="resp__big" role="status">{done}</p>;
  return (
    <>
      {s === "err" && <p className="notice notice--error" role="alert">{error}</p>}
      <button type="button" className="easy__btn easy__btn--main" onClick={() => void go()} disabled={s === "busy"}>{label}</button>
    </>
  );
}

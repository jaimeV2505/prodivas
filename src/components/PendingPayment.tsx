"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Mientras Stripe confirma el pago, recarga la página cada 3 s (máx. 3 min). */
export default function PendingPayment() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      n++;
      router.refresh();
      if (n > 60) clearInterval(id);
    }, 3000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}

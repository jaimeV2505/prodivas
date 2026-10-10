"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentProps, MouseEvent } from "react";
import { useReducedMotion } from "framer-motion";

type Props = ComponentProps<typeof Link>;

/** Enlace que tapa la pantalla con la cortina y navega justo después. Sin JS, es un enlace normal. */
export default function TransitionLink({ href, onClick, children, ...rest }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const reduce = useReducedMotion();

  function handle(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented || reduce) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const url = typeof href === "string" ? href : (href.pathname ?? "");
    const target = url.split("#")[0].split("?")[0];
    if (!target.startsWith("/") || target === pathname) return;

    e.preventDefault();
    const root = document.documentElement;
    root.dataset.leaving = "1";
    window.setTimeout(() => router.push(url), 440);
    // Red de seguridad: si la navegación no llega, se quita la cortina
    window.setTimeout(() => {
      if (root.dataset.leaving === "1") delete root.dataset.leaving;
    }, 3500);
  }

  return (
    <Link href={href} onClick={handle} {...rest}>
      {children}
    </Link>
  );
}

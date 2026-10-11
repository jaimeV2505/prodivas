"use client";

import { useRouter } from "next/navigation";
import { LANGS, LANG_LABEL, type Lang } from "@/lib/i18n";

/** Castellano · Galego · English. Se recuerda en una cookie y la reserva en curso no se pierde al cambiar. */
export default function LangSwitch({ lang, label }: { lang: Lang; label: string }) {
  const router = useRouter();
  function set(l: Lang) {
    document.cookie = `pd_lang=${l}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }
  return (
    <div className="lang" role="group" aria-label={label}>
      {LANGS.map((l) => (
        <button key={l} type="button" lang={l} className={`lang__btn ${l === lang ? "is-on" : ""}`} aria-pressed={l === lang} onClick={() => set(l)}>
          {LANG_LABEL[l]}
        </button>
      ))}
    </div>
  );
}

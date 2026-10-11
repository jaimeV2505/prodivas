"use client";

import { useState } from "react";
import { getDict, type Dict } from "@/lib/i18n";
import { quizAddon, quizResult, quizServices, type Last, type QuizAnswers, type QuizResultId, type Style, type Time } from "@/lib/quiz";

type Props = {
  /** Slugs de los servicios que existen. */
  catalog: string[];
  /** Slugs de los extras que existen. */
  addonSlugs: string[];
  onPick: (serviceSlugs: string[], addonSlug: string | null) => void;
};

const RESULT_KEY: Record<QuizResultId, [keyof Dict, keyof Dict]> = {
  quick: ["quizRQuickT", "quizRQuickB"],
  daily: ["quizRDailyT", "quizRDailyB"],
  pair: ["quizRPairT", "quizRPairB"],
  full: ["quizRFullT", "quizRFullB"],
};
const TIP_KEY: Record<Style, keyof Dict> = { natural: "quizTipNatural", classic: "quizTipClassic", bold: "quizTipBold" };

/** «¿Qué manicura eres?»: tres preguntas de un toque y una recomendación para reservar. */
export default function Quiz({ catalog, addonSlugs, onPick }: Props) {
  const T = getDict();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Partial<QuizAnswers>>({});

  const QUESTIONS: { q: keyof Dict; field: keyof QuizAnswers; opts: { id: Time | Style | Last; label: keyof Dict }[] }[] = [
    { q: "quizQ1", field: "time", opts: [{ id: "short", label: "quizQ1a" }, { id: "normal", label: "quizQ1b" }, { id: "long", label: "quizQ1c" }] },
    { q: "quizQ2", field: "style", opts: [{ id: "natural", label: "quizQ2a" }, { id: "classic", label: "quizQ2b" }, { id: "bold", label: "quizQ2c" }] },
    { q: "quizQ3", field: "last", opts: [{ id: "event", label: "quizQ3a" }, { id: "weeks", label: "quizQ3b" }, { id: "max", label: "quizQ3c" }] },
  ];
  const reset = () => {
    setStep(0);
    setA({});
  };
  if (!open) {
    return (
      <button type="button" className="quiz__cta" onClick={() => setOpen(true)}>
        {T.quizCta}
      </button>
    );
  }
  const done = step >= 3;
  const answers = a as QuizAnswers;
  const result = done ? quizResult(answers) : null;
  const slugs = result ? quizServices(result, catalog) : [];
  const addon = done && quizAddon(answers) && addonSlugs.includes(quizAddon(answers) as string) ? quizAddon(answers) : null;

  return (
    <section className="quiz" aria-label={T.quizTitle}>
      <h3>🎀 {T.quizTitle}</h3>
      {!done ? (
        <>
          <p className="quiz__q" role="status">{T[QUESTIONS[step].q]}</p>
          <div className="quiz__opts">
            {QUESTIONS[step].opts.map((o) => (
              <button key={o.id} type="button" className="quiz__opt" onClick={() => { setA({ ...a, [QUESTIONS[step].field]: o.id }); setStep(step + 1); }}>
                {T[o.label]}
              </button>
            ))}
          </div>
          <p className="quiz__nav">
            <span className="muted small">{step + 1} / 3</span>
            {step > 0 ? <button type="button" className="resp__link" onClick={() => setStep(step - 1)}>{T.quizBack}</button> : <button type="button" className="resp__link" onClick={() => setOpen(false)}>{T.close}</button>}
          </p>
        </>
      ) : (
        result && (
          <div className="quiz__res" role="status">
            <p className="quiz__rt">{T[RESULT_KEY[result][0]]}</p>
            <p>{T[RESULT_KEY[result][1]]}</p>
            <p className="muted">{T[TIP_KEY[answers.style]]}</p>
            <button type="button" className="btn btn--primary btn--lg" onClick={() => onPick(slugs, addon)}>{T.quizPick}</button>
            <button type="button" className="resp__link" onClick={reset}>{T.quizRestart}</button>
          </div>
        )
      )}
    </section>
  );
}

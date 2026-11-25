import type { ReactNode } from "react";
import type { Tone } from "./offline";

export const Chip = ({ tone = "dim", children }: { tone?: Tone; children: ReactNode }) => <span className={`lab-chip ${tone}`}>{children}</span>;

export function Card({ code, title, verdict, tone, rows, children }: { code: string; title: string; verdict: string; tone: Tone; rows?: [string, ReactNode][]; children?: ReactNode }) {
  return (
    <div className="lab-card" data-testid={`card-${code}`}>
      <header><b>{code}</b><span>{title}</span></header>
      <Chip tone={tone}>{verdict}</Chip>
      {rows && <dl>{rows.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="num">{v}</dd></div>)}</dl>}
      {children}
    </div>
  );
}

export const BeforeAfter = ({ t0, t1 }: { t0: string; t1: string }) => (
  <div className="lab-ba"><figure><img src={t0} alt="before" /><figcaption>before</figcaption></figure><figure><img src={t1} alt="after" /><figcaption>after</figcaption></figure></div>
);

"use client";
import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea,
} from "recharts";
import { Plus, Trash2 } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";

type LifeStage = {
  id: string;
  label: string;
  startAge: number;
  endAge: number;
  monthlyContribution: number;
  color: string;
};

type CalculatorState = {
  currentAge: number;
  retirementAge: number;
  startingPortfolio: number;
  annualReturn: number;
  inflationRate: number;
  stages: LifeStage[];
};

const STORAGE_KEY = "dabudge_investment_calculator_v1";

const STAGE_COLORS = ["#50C878", "#4EA8FF", "#F9B43B", "#9D59D5", "#FF5C5C", "#3BDBB4"];

const DEFAULT_STATE: CalculatorState = {
  currentAge: 25,
  retirementAge: 65,
  startingPortfolio: 10000,
  annualReturn: 7,
  inflationRate: 3,
  stages: [
    { id: "s1", label: "Early Career", startAge: 25, endAge: 35, monthlyContribution: 500, color: STAGE_COLORS[0] },
    { id: "s2", label: "Mid Career", startAge: 35, endAge: 50, monthlyContribution: 1000, color: STAGE_COLORS[1] },
    { id: "s3", label: "Peak Earning", startAge: 50, endAge: 65, monthlyContribution: 1500, color: STAGE_COLORS[2] },
  ],
};

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function stageForAge(stages: LifeStage[], age: number): LifeStage | null {
  return stages.find((s) => age >= s.startAge && age < s.endAge) ?? null;
}

export default function InvestmentCalculatorPage() {
  const [state, setState] = useState<CalculatorState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setState({ ...DEFAULT_STATE, ...JSON.parse(raw) });
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, [state, hydrated]);

  const update = (patch: Partial<CalculatorState>) => setState((s) => ({ ...s, ...patch }));

  const projection = useMemo(() => {
    const data: { age: number; nominal: number; real: number; contributed: number }[] = [];
    let nominal = state.startingPortfolio;
    let contributed = state.startingPortfolio;
    for (let age = state.currentAge; age <= state.retirementAge; age++) {
      const stage = stageForAge(state.stages, age);
      const annualContribution = stage ? stage.monthlyContribution * 12 : 0;
      if (age > state.currentAge) {
        nominal = nominal * (1 + state.annualReturn / 100) + annualContribution;
        contributed += annualContribution;
      }
      const real = nominal / Math.pow(1 + state.inflationRate / 100, age - state.currentAge);
      data.push({ age, nominal: Math.round(nominal), real: Math.round(real), contributed: Math.round(contributed) });
    }
    return data;
  }, [state]);

  const last = projection[projection.length - 1];
  const finalNominal = last?.nominal ?? 0;
  const finalReal = last?.real ?? 0;
  const totalContributed = last?.contributed ?? 0;
  const totalGrowth = finalNominal - totalContributed;
  const growthMultiplier = totalContributed > 0 ? finalNominal / totalContributed : 0;

  const sortedStages = useMemo(() => [...state.stages].sort((a, b) => a.startAge - b.startAge), [state.stages]);

  function addStage() {
    const lastStage = sortedStages[sortedStages.length - 1];
    const start = lastStage ? lastStage.endAge : state.currentAge;
    const color = STAGE_COLORS[state.stages.length % STAGE_COLORS.length];
    const newStage: LifeStage = {
      id: `s${Date.now()}`,
      label: "New Stage",
      startAge: Math.min(start, state.retirementAge - 1),
      endAge: Math.min(start + 10, state.retirementAge),
      monthlyContribution: 500,
      color,
    };
    update({ stages: [...state.stages, newStage] });
  }

  function updateStage(id: string, patch: Partial<LifeStage>) {
    update({ stages: state.stages.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  }

  function removeStage(id: string) {
    update({ stages: state.stages.filter((s) => s.id !== id) });
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-white">Life-Stage Planner</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 space-y-4">
            <Card title="Assumptions">
              <div className="space-y-4">
                <SliderField label="Current age" value={state.currentAge} min={18} max={80}
                  onChange={(v) => update({ currentAge: v, retirementAge: Math.max(v + 1, state.retirementAge) })} />
                <SliderField label="Retirement age" value={state.retirementAge} min={state.currentAge + 1} max={85}
                  onChange={(v) => update({ retirementAge: v })} />
                <NumberField label="Starting portfolio" value={state.startingPortfolio} prefix="$"
                  onChange={(v) => update({ startingPortfolio: v })} />
                <SliderField label="Annual return" value={state.annualReturn} min={0} max={15} step={0.5} suffix="%"
                  onChange={(v) => update({ annualReturn: v })} />
                <SliderField label="Inflation rate" value={state.inflationRate} min={0} max={10} step={0.5} suffix="%"
                  onChange={(v) => update({ inflationRate: v })} />
              </div>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Metric label="Final (nominal)" value={fmt(finalNominal)} accent="#50C878" />
              <Metric label="Final (real)" value={fmt(finalReal)} accent="#4EA8FF" />
              <Metric label="Contributed" value={fmt(totalContributed)} accent="#F9B43B" />
              <Metric label="Growth" value={fmt(totalGrowth)} accent="#9D59D5" />
              <Metric label="Multiplier" value={`${growthMultiplier.toFixed(1)}x`} accent="#3BDBB4" />
              <Metric label="Years" value={`${state.retirementAge - state.currentAge}`} accent="#FF8000" />
            </div>

            <Card title="Projected Portfolio">
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={projection} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
                    <CartesianGrid stroke="#333" strokeDasharray="3 3" />
                    {sortedStages.map((s) => (
                      <ReferenceArea key={s.id} x1={s.startAge} x2={s.endAge} fill={s.color} fillOpacity={0.07} stroke="none" />
                    ))}
                    <XAxis dataKey="age" stroke="#888" fontSize={12} />
                    <YAxis stroke="#888" fontSize={12} width={64}
                      tickFormatter={(v) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)} />
                    <Tooltip
                      contentStyle={{ background: "#252525", border: "1px solid #333", borderRadius: 8, color: "#fff" }}
                      formatter={(v: number, name) => [fmt(v), name === "nominal" ? "Nominal" : name === "real" ? "Real" : "Contributed"]}
                      labelFormatter={(l) => `Age ${l}`} />
                    <Line type="monotone" dataKey="nominal" stroke="#50C878" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="real" stroke="#4EA8FF" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                    <Line type="monotone" dataKey="contributed" stroke="#F9B43B" strokeWidth={1.5} strokeDasharray="2 3" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </div>

        <Card title="Life Stages" action={
          <button onClick={addStage} className="flex items-center gap-1 text-xs text-gray-400 hover:text-accent transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add stage
          </button>
        }>
          <div className="space-y-3">
            {sortedStages.map((stage) => (
              <div key={stage.id} className="rounded-lg bg-charcoal border border-charcoal-dark p-3">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: stage.color }} />
                  <input value={stage.label} onChange={(e) => updateStage(stage.id, { label: e.target.value })}
                    className="flex-1 bg-transparent text-white font-medium focus:outline-none border-b border-transparent focus:border-charcoal-dark" />
                  <button onClick={() => removeStage(stage.id)} className="text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <MiniField label="Start age" value={stage.startAge} onChange={(v) => updateStage(stage.id, { startAge: v })} />
                  <MiniField label="End age" value={stage.endAge} onChange={(v) => updateStage(stage.id, { endAge: v })} />
                  <MiniField label="Monthly $" value={stage.monthlyContribution} onChange={(v) => updateStage(stage.id, { monthlyContribution: v })} />
                </div>
              </div>
            ))}
            {sortedStages.length === 0 && <p className="text-gray-500 text-sm text-center py-4">No stages. Add one to begin.</p>}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[#252525] border border-charcoal-dark overflow-hidden">
      <div className="px-4 py-3 bg-[#353535] border-b border-charcoal-dark flex items-center justify-between">
        <h2 className="text-white font-medium text-sm">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl bg-[#252525] border border-charcoal-dark p-3">
      <p className="text-[11px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className="text-lg font-semibold mt-0.5" style={{ color: accent }}>{value}</p>
    </div>
  );
}

function SliderField({ label, value, min, max, step = 1, suffix, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm text-gray-300">{label}</label>
        <span className="text-sm text-white">{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </div>
  );
}

function NumberField({ label, value, prefix, onChange }: {
  label: string; value: number; prefix?: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="block text-sm text-gray-300 mb-1">{label}</label>
      <div className="flex items-center rounded-lg bg-charcoal border border-charcoal-dark focus-within:border-accent">
        {prefix && <span className="pl-3 text-gray-500">{prefix}</span>}
        <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)}
          className="w-full px-3 py-2 bg-transparent text-gray-200 focus:outline-none" />
      </div>
    </div>
  );
}

function MiniField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-[11px] text-gray-500 mb-1">{label}</label>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full px-2 py-1.5 rounded-lg bg-[#252525] border border-charcoal-dark text-gray-200 text-sm focus:border-accent focus:ring-1 focus:ring-accent outline-none" />
    </div>
  );
}

import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer } from "recharts";

export function WinRateChart({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const data = [{ name: "win", value: v }];
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={180}>
        <RadialBarChart data={data} innerRadius="72%" outerRadius="100%" startAngle={90} endAngle={-270}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background dataKey="value" cornerRadius={10} fill="var(--chart-1)" />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold">{v.toFixed(0)}%</span>
        <span className="text-xs text-muted-foreground">win rate</span>
      </div>
    </div>
  );
}

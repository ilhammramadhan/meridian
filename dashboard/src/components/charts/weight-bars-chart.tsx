import { Bar, BarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function WeightBarsChart({ data }: { data: { name: string; weight: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 30)}>
      <BarChart data={data} layout="vertical" margin={{ left: 24, right: 16, top: 4, bottom: 4 }}>
        <XAxis type="number" domain={[0, 2.5]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
        <ReferenceLine x={1} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
        <Bar dataKey="weight" fill="var(--chart-1)" radius={4} />
      </BarChart>
    </ResponsiveContainer>
  );
}

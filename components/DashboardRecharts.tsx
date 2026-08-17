import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { formatEUR } from '../utils/formatMoney';
import type { InventoryItem } from '../types';

const PIE_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1', '#64748B'];

export type DashboardChartPoint = {
  name: string;
  revenue: number;
  itemProfit: number;
  expTotal: number;
  netProfit: number;
  soldItems: InventoryItem[];
  dayLabel: string;
  dateStr: string;
};

export type DayDetailPayload = {
  dayLabel: string;
  dateStr: string;
  items: InventoryItem[];
  revenue?: number;
  itemProfit?: number;
  expTotal?: number;
  netProfit?: number;
};

export function DashboardPerformanceChart({
  chartData,
  onOpenDay,
}: {
  chartData: DashboardChartPoint[];
  onOpenDay: (p: DayDetailPayload) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis
          dataKey="name"
          axisLine={false}
          tickLine={false}
          tick={(props: { x: number; y: number; payload?: { value?: string }; index?: number }) => {
            const { x, y, payload, index } = props;
            const point = typeof index === 'number' ? chartData[index] : chartData.find((d) => d.name === payload?.value);
            return (
              <g transform={`translate(${x},${y})`} style={{ cursor: 'pointer' }}>
                <text
                  x={0}
                  y={0}
                  dy={8}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize={12}
                  fontWeight="bold"
                  onClick={() =>
                    point &&
                    onOpenDay({
                      dayLabel: point.dayLabel,
                      dateStr: point.dateStr,
                      items: point.soldItems ?? [],
                      revenue: point.revenue,
                      itemProfit: point.itemProfit,
                      expTotal: point.expTotal,
                      netProfit: point.netProfit,
                    })
                  }
                  role="button"
                  tabIndex={0}
                >
                  {payload?.value}
                </text>
              </g>
            );
          }}
        />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} width={48} />
        <Tooltip
          cursor={{ fill: '#f8fafc' }}
          contentStyle={{ borderRadius: '12px', border: 'none', fontSize: '12px' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]?.payload as DashboardChartPoint | undefined;
            const sold = p?.soldItems ?? [];
            const itemProfit = Number(p?.itemProfit) || 0;
            const expTotal = Number(p?.expTotal) || 0;
            return (
              <div className="bg-white rounded-lg border border-slate-200 shadow-lg p-2 text-xs">
                <p className="font-bold text-slate-500 mb-1">{p?.dayLabel ?? p?.name}</p>
                {payload.map((entry) => (
                  <p key={String(entry.dataKey)} className="font-bold">€{formatEUR(Number(entry.value))} ({entry.name})</p>
                ))}
                <p className="text-slate-500 mt-1">Sale €{formatEUR(itemProfit)}{expTotal > 0 ? ` · Exp −€${formatEUR(expTotal)}` : ''}</p>
                {sold.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenDay({
                        dayLabel: p?.dayLabel ?? p?.name ?? '',
                        dateStr: p?.dateStr ?? '',
                        items: sold,
                        revenue: p?.revenue,
                        itemProfit: p?.itemProfit,
                        expTotal: p?.expTotal,
                        netProfit: p?.netProfit,
                      })
                    }
                    className="mt-1 font-bold text-blue-600 hover:underline"
                  >
                    {sold.length} sold →
                  </button>
                )}
              </div>
            );
          }}
        />
        <Bar
          dataKey="revenue"
          fill="#3B82F6"
          radius={[4, 4, 0, 0]}
          name="Revenue"
          maxBarSize={40}
          onClick={(data: { payload?: DashboardChartPoint } | DashboardChartPoint) => {
            const p = ('payload' in data && data.payload) ? data.payload : (data as DashboardChartPoint);
            onOpenDay({
              dayLabel: p?.dayLabel ?? '',
              dateStr: p?.dateStr ?? '',
              items: p?.soldItems ?? [],
              revenue: p?.revenue,
              itemProfit: p?.itemProfit,
              expTotal: p?.expTotal,
              netProfit: p?.netProfit,
            });
          }}
        />
        <Bar
          dataKey="netProfit"
          fill="#10B981"
          radius={[4, 4, 0, 0]}
          name="Net"
          maxBarSize={40}
          onClick={(data: { payload?: DashboardChartPoint } | DashboardChartPoint) => {
            const p = ('payload' in data && data.payload) ? data.payload : (data as DashboardChartPoint);
            onOpenDay({
              dayLabel: p?.dayLabel ?? '',
              dateStr: p?.dateStr ?? '',
              items: p?.soldItems ?? [],
              revenue: p?.revenue,
              itemProfit: p?.itemProfit,
              expTotal: p?.expTotal,
              netProfit: p?.netProfit,
            });
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DashboardStockPie({
  categoryData,
}: {
  categoryData: { name: string; value: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={categoryData} cx="50%" cy="50%" innerRadius="42%" outerRadius="68%" paddingAngle={3} dataKey="value">
          {categoryData.map((_, index) => (
            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} stroke="none" />
          ))}
        </Pie>
        <Tooltip formatter={(value: number) => `€${formatEUR(value)}`} contentStyle={{ borderRadius: '12px', fontSize: '13px' }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export { PIE_COLORS };

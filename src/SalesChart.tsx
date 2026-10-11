import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type Point = { period: string; cash: number; kpay: number; wavepay: number; total: number }

export default function SalesChart({ points, formatMoney }: { points: Point[]; formatMoney: (value: number) => string }) {
  return <ResponsiveContainer width="100%" height="100%">
    <AreaChart data={points} margin={{ top: 12, right: 6, left: -16, bottom: 0 }}>
      <defs>
        <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#39b981" stopOpacity={0.18} /><stop offset="95%" stopColor="#39b981" stopOpacity={0} /></linearGradient>
        <linearGradient id="kpayFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6887f7" stopOpacity={0.14} /><stop offset="95%" stopColor="#6887f7" stopOpacity={0} /></linearGradient>
      </defs>
      <CartesianGrid stroke="#edf0f4" vertical={false} />
      <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: '#9198a6', fontSize: 11 }} tickMargin={12} />
      <YAxis tickLine={false} axisLine={false} tick={{ fill: '#9198a6', fontSize: 11 }} tickFormatter={value => `${value}`} />
      <Tooltip formatter={value => formatMoney(Number(value))} contentStyle={{ border: '1px solid #e9edf2', borderRadius: 9, fontSize: 12 }} />
      <Area type="monotone" dataKey="cash" name="Cash" stroke="#39b981" strokeWidth={2} fill="url(#cashFill)" />
      <Area type="monotone" dataKey="kpay" name="KPay" stroke="#6887f7" strokeWidth={2} fill="url(#kpayFill)" />
      <Area type="monotone" dataKey="wavepay" name="WavePay" stroke="#a178e8" strokeWidth={2} fill="transparent" />
    </AreaChart>
  </ResponsiveContainer>
}

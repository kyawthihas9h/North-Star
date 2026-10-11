import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowDownToLine, ArrowRight, Barcode, Bell, Boxes, Camera, Check,
  ChevronDown, CircleDollarSign, ClipboardList, CreditCard, FileSpreadsheet,
  LayoutDashboard, LogOut, Menu, Minus, Package, Plus, QrCode, Search, Settings,
  Copy, Eye, EyeOff, KeyRound, ShieldCheck, ShoppingBag, Smartphone, Star, Trash2, Upload, Users, X,
} from 'lucide-react'
import './App.css'

type Role = 'admin' | 'cashier'
type User = { id: number; name: string; username: string; role: Role }
type Cashier = { id: number; username: string; role: 'cashier'; is_active: boolean; created_at: string }
type Product = { id: number; name: string; barcode: string; image_url: string | null; qty: number; price: number }
type Line = Product & { count: number }
type Sale = { id: number; receipt_no: string; created_at: string; cashier: string; payment_method: 'cash' | 'kpay' | 'wavepay'; total: number; tax: number; item_count: number }
type SettingsData = { tax_rate: string; kpay_qr: string; wavepay_qr: string }
type ReportPoint = { period: string; cash: number; kpay: number; wavepay: number; total: number }
type Period = 'day' | 'month' | 'year'
type ApiResponse = { error?: string; [key: string]: unknown }
const SalesChart = lazy(() => import('./SalesChart'))

const fetchApi = async (input: RequestInfo | URL, init?: RequestInit) => {
  try {
    return await fetch(input, init)
  } catch {
    throw new Error('Cannot reach the POS API. Check the server terminal, MySQL connection, and that npm run dev is running.')
  }
}

const readJsonResponse = async <T extends ApiResponse = ApiResponse>(response: Response): Promise<T> => {
  const body = await response.text()
  if (!body.trim()) {
    if (response.ok) throw new Error('The POS API returned an empty response. Restart the API and try again.')
    throw new Error(`The POS API returned an empty error response (HTTP ${response.status}). Check that the API and MySQL are running.`)
  }
  try {
    return JSON.parse(body) as T
  } catch {
    throw new Error(response.ok
      ? 'The POS API returned an invalid response. Restart the API and try again.'
      : `The POS API could not complete the request (HTTP ${response.status}). Check that the API and MySQL are running.`)
  }
}

const api = async <T extends ApiResponse>(path: string, token: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetchApi(`/api${path}`, {
    ...options,
    headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), Authorization: `Bearer ${token}`, ...options.headers },
  })
  const data = await readJsonResponse<T>(response)
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${response.status})`)
  return data as T
}

const money = (value: number) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)} Ks`
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const today = () => localDate(new Date())
const dateRange = (period: Period, date: string) => {
  const selected = new Date(`${date}T12:00:00`)
  if (period === 'day') return { from: date, to: date }
  if (period === 'month') return { from: localDate(new Date(selected.getFullYear(), selected.getMonth(), 1)), to: localDate(new Date(selected.getFullYear(), selected.getMonth() + 1, 0)) }
  return { from: `${selected.getFullYear()}-01-01`, to: `${selected.getFullYear()}-12-31` }
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('pos_token') || '')
  const [user, setUser] = useState<User | null>(null)
  const [loginMode, setLoginMode] = useState<Role>('admin')
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [setupError, setSetupError] = useState('')
  const [page, setPage] = useState('Dashboard')
  const [drawer, setDrawer] = useState(false)
  const [toast, setToast] = useState('')
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3500) }
  const logout = useCallback(() => {
    localStorage.removeItem('pos_token')
    setToken('')
    setUser(null)
    setPage('Dashboard')
  }, [])
  useEffect(() => {
    if (!token) return
    api<{ user: User }>('/auth/me', token).then(result => setUser(result.user)).catch(logout)
  }, [token, logout])
  useEffect(() => {
    let active = true
    fetchApi('/api/auth/setup-status')
      .then(readJsonResponse<{ setup_required: boolean }>)
      .then(result => { if (active) { setSetupRequired(result.setup_required); setSetupError('') } })
      .catch(error => { if (active) { setSetupRequired(false); setSetupError(error instanceof Error ? error.message : 'Could not connect to the POS API.') } })
    return () => { active = false }
  }, [])
  const onLogin = (accessToken: string, currentUser: User) => {
    localStorage.setItem('pos_token', accessToken)
    setToken(accessToken)
    setUser(currentUser)
    setPage(currentUser.role === 'cashier' ? 'POS' : 'Dashboard')
  }
  if (!token || !user) {
    if (setupRequired === null) return <div className="setup-loading">Connecting to North Star…</div>
    if (setupRequired) return <InitialAdminSetup onLogin={onLogin} />
    return <Login mode={loginMode} setMode={setLoginMode} onLogin={onLogin} connectionError={setupError} />
  }
  if (user.role === 'cashier') return <Pos token={token} user={user} logout={logout} notify={notify} />
  const nav = [
    { name: 'Dashboard', icon: LayoutDashboard },
    { name: 'Inventory', icon: Boxes },
    { name: 'Sale Record', icon: ClipboardList },
    { name: 'Settings', icon: Settings },
  ]
  return <div className="app-shell">
    <aside className={`sidebar ${drawer ? 'open' : ''}`}>
      <a className="brand" href="#" onClick={event => event.preventDefault()}><span className="brand-mark"><Star size={20} fill="currentColor" /></span><span>North Star<small>RETAIL SYSTEMS</small></span></a>
      <div className="workspace"><span className="workspace-icon">A</span><span><b>Accessories store</b><small>My store</small></span><ChevronDown size={15} /></div>
      <p className="nav-label">WORKSPACE</p>
      <nav>{nav.map(item => <button key={item.name} className={`nav-item ${page === item.name ? 'active' : ''}`} onClick={() => { setPage(item.name); setDrawer(false) }}><item.icon size={18} /><span>{item.name}</span>{item.name === 'Inventory' && <span className="nav-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><span className="help-icon"><ShieldCheck size={17} /></span><div><b>Store is secure</b><small>All systems operational</small></div><span className="status-dot" /></div>
        <button className="user-card" onClick={logout}><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><b>{user.name}</b><small>Administrator · Sign out</small></span><LogOut size={17} /></button></div>
    </aside>
    {drawer && <button className="overlay" aria-label="Close navigation" onClick={() => setDrawer(false)} />}
    <main className="main-area">
      <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setDrawer(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="breadcrumbs">Workspace <span>/</span> <b>{page}</b></div><div className="topbar-right"><span className="live-status"><i /> Store live</span><button className="icon-button notifications" aria-label="Notifications"><Bell size={18} /><i /></button><span className="top-avatar">{user.name.slice(0, 1).toUpperCase()}</span></div></header>
      {page === 'Dashboard' && <Dashboard token={token} />}
      {page === 'Inventory' && <Inventory token={token} notify={notify} />}
      {page === 'Sale Record' && <SaleRecords token={token} />}
      {page === 'Settings' && <SettingsPage token={token} notify={notify} />}
    </main>
    {toast && <div className="toast"><Check size={16} />{toast}</div>}
  </div>
}

function Login({ mode, setMode, onLogin, connectionError }: { mode: Role; setMode: (role: Role) => void; onLogin: (token: string, user: User) => void; connectionError: string }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const response = await fetchApi('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, mode }) })
      const data = await readJsonResponse<{ token: string; user: User; error?: string }>(response)
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Sign in failed')
      onLogin(data.token, data.user)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign in') }
    finally { setLoading(false) }
  }
  return <div className="login-screen">
    <div className="login-decoration"><div className="decor-grid" /><div className="decor-content"><span className="brand-mark large"><Star size={24} fill="currentColor" /></span><p className="eyebrow">SMARTER RETAIL, EVERY DAY</p><h1>Everything your<br />store needs to <em>grow.</em></h1><p className="decor-copy">A simpler way to manage your inventory, serve customers, and understand your business.</p><div className="decor-pills"><span><Boxes size={15} /> Inventory</span><span><ShoppingBag size={15} /> Point of sale</span><span><Activity size={15} /> Insights</span></div><div className="decor-footer">NORTH STAR <span>·</span> COMPUTER & LAPTOP ACCESSORIES</div></div></div>
    <div className="login-panel"><div className="login-inner"><div className="login-mobile-brand"><span className="brand-mark"><Star size={20} fill="currentColor" /></span>North Star</div><div className="login-heading"><span className="eyebrow">WELCOME BACK</span><h2>Sign in to your store</h2><p>Choose your workspace to continue.</p></div>{connectionError && <div className="form-error">{connectionError}</div>}<div className="login-tabs"><button className={mode === 'admin' ? 'selected' : ''} onClick={() => setMode('admin')}><LayoutDashboard size={17} /> Admin panel</button><button className={mode === 'cashier' ? 'selected' : ''} onClick={() => setMode('cashier')}><ShoppingBag size={17} /> POS terminal</button></div><form className="login-form" onSubmit={submit}><label>Username<input type="text" autoComplete="username" required minLength={3} maxLength={80} value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter your username" /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" /></label>{error && <div className="form-error">{error}</div>}<button className="button primary full" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}<ArrowRight size={17} /></button></form><div className="login-note"><ShieldCheck size={16} /><span>Your sign-in is encrypted and secure.</span></div></div><div className="login-legal">NORTH STAR RETAIL SYSTEMS <span>·</span> PRIVATE STORE ACCESS</div></div>
  </div>
}

function InitialAdminSetup({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (password !== confirmPassword) { setError('The passwords do not match.'); return }
    setSaving(true)
    try {
      const response = await fetchApi('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const result = await readJsonResponse<{ token: string; user: User; error?: string }>(response)
      if (!response.ok) throw new Error(result.error || 'Could not create the administrator account.')
      onLogin(result.token, result.user)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the administrator account.')
    } finally {
      setSaving(false)
    }
  }
  return <div className="login-screen">
    <div className="login-decoration"><div className="decor-grid" /><div className="decor-content"><span className="brand-mark large"><Star size={24} fill="currentColor" /></span><p className="eyebrow">WELCOME TO NORTH STAR</p><h1>Set up your<br />store <em>securely.</em></h1><p className="decor-copy">Create the first administrator account. Usernames and securely hashed passwords are stored in your MySQL database.</p><div className="decor-pills"><span><ShieldCheck size={15} /> Private access</span><span><Boxes size={15} /> Your inventory</span></div><div className="decor-footer">NORTH STAR <span>·</span> COMPUTER & LAPTOP ACCESSORIES</div></div></div>
    <div className="login-panel"><div className="login-inner"><div className="login-mobile-brand"><span className="brand-mark"><Star size={20} fill="currentColor" /></span>North Star</div><div className="login-heading"><span className="eyebrow">FIRST-TIME SETUP</span><h2>Create administrator</h2><p>Choose the username and password you’ll use to sign in.</p></div><form className="login-form" onSubmit={submit}><label>Admin username<input autoComplete="username" required minLength={3} maxLength={80} pattern="[a-zA-Z0-9._-]+" value={username} onChange={event => setUsername(event.target.value)} placeholder="Choose a username" /></label><label>Admin password<input type="password" autoComplete="new-password" required minLength={12} maxLength={200} value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 12 characters" /></label><label>Confirm password<input type="password" autoComplete="new-password" required minLength={12} maxLength={200} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Enter the password again" /></label>{error && <div className="form-error">{error}</div>}<button className="button primary full" disabled={saving}>{saving ? 'Creating account…' : 'Create admin account'}<ArrowRight size={17} /></button></form><div className="login-note"><ShieldCheck size={16} /><span>Your password is securely hashed before it is stored.</span></div></div><div className="login-legal">NORTH STAR RETAIL SYSTEMS <span>·</span> PRIVATE STORE ACCESS</div></div>
  </div>
}

function PageHeading({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>
}

function Dashboard({ token }: { token: string }) {
  const [period, setPeriod] = useState<Period>('day')
  const [date, setDate] = useState(today())
  const [report, setReport] = useState<{ points: ReportPoint[]; summary: { sales: number; orders: number; items: number; cash: number; kpay: number; wavepay: number } } | null>(null)
  const [error, setError] = useState('')
  const range = useMemo(() => dateRange(period, date), [period, date])
  useEffect(() => {
    api<NonNullable<typeof report>>(`/reports/summary?from=${range.from}&to=${range.to}&period=${period}`, token).then(result => { setReport(result); setError('') }).catch(e => setError(e.message))
  }, [token, range, period])
  const summary = report?.summary
  const paymentCards = [
    { name: 'Cash', value: summary?.cash, icon: CircleDollarSign, tone: 'green' },
    { name: 'KPay', value: summary?.kpay, icon: Smartphone, tone: 'blue' },
    { name: 'WavePay', value: summary?.wavepay, icon: CreditCard, tone: 'violet' },
  ]
  return <div className="page-content"><PageHeading eyebrow="OVERVIEW" title="Dashboard" subtitle="A clear view of how your store is doing." action={<div className="date-control"><select value={period} onChange={e => setPeriod(e.target.value as Period)}><option value="day">Day</option><option value="month">Month</option><option value="year">Year</option></select><input aria-label="Select date" type={period === 'day' ? 'date' : period === 'month' ? 'month' : 'number'} value={period === 'year' ? date.slice(0, 4) : period === 'month' ? date.slice(0, 7) : date} onChange={e => setDate(period === 'year' ? `${e.target.value}-01-01` : period === 'month' ? `${e.target.value}-01` : e.target.value)} /></div>} />
    {error && <div className="error-banner">{error}</div>}
    <div className="stat-grid"><StatCard title="Total sales" value={summary ? money(summary.sales) : '—'} caption="For the selected period" icon={CircleDollarSign} tone="green" /><StatCard title="Orders" value={summary ? String(summary.orders) : '—'} caption="Completed transactions" icon={ShoppingBag} tone="blue" /><StatCard title="Items sold" value={summary ? String(summary.items) : '—'} caption="Units across all orders" icon={Package} tone="violet" /></div>
    <div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-heading"><div><h3>Sales performance</h3><p>Payment breakdown for the selected period</p></div><div className="chart-legend"><span><i className="cash-dot" /> Cash</span><span><i className="kpay-dot" /> KPay</span><span><i className="wave-dot" /> WavePay</span></div></div><div className="chart-wrap">{report?.points.length ? <Suspense fallback={<div className="chart-loading">Loading chart…</div>}><SalesChart points={report.points} formatMoney={money} /></Suspense> : <EmptyState icon={Activity} title="Your chart is ready" description="Sales activity will appear here once the first checkout is completed." />}</div></section>
      <section className="panel payment-panel"><div className="panel-heading"><div><h3>Payment methods</h3><p>Collected in this period</p></div><span className="panel-icon"><CreditCard size={18} /></span></div><div className="payment-methods">{paymentCards.map(card => <div className="payment-row" key={card.name}><span className={`payment-icon ${card.tone}`}><card.icon size={17} /></span><span className="payment-name">{card.name}<small>{summary ? `${summary.orders ? 'Recorded' : 'No transactions'}` : 'Loading'}</small></span><strong>{summary ? money(card.value || 0) : '—'}</strong></div>)}</div><div className="payment-total"><span>Total collected</span><b>{summary ? money(summary.sales) : '—'}</b></div><p className="tax-note">Sales totals include recorded tax.</p></section></div>
    <div className="dashboard-footnote"><span className="status-dot" /> Live data from your store <span>·</span> {range.from === range.to ? range.from : `${range.from} — ${range.to}`}</div>
  </div>
}

function StatCard({ title, value, caption, icon: Icon, tone }: { title: string; value: string; caption: string; icon: typeof Activity; tone: string }) {
  return <section className="panel stat-card"><div className={`stat-icon ${tone}`}><Icon size={19} /></div><div className="stat-copy"><span>{title}</span><strong>{value}</strong><small>{caption}</small></div><span className="stat-period">PERIOD</span></section>
}

function EmptyState({ icon: Icon, title, description }: { icon: typeof Activity; title: string; description: string }) {
  return <div className="empty-state"><span><Icon size={21} /></span><b>{title}</b><p>{description}</p></div>
}

function Inventory({ token, notify }: { token: string; notify: (message: string) => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<Product | 'new' | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    api<{ products: Product[] }>(`/products?search=${encodeURIComponent(search)}`, token).then(data => { setProducts(data.products); setError('') }).catch(e => setError(e.message)).finally(() => setBusy(false))
  }, [token, search])
  useEffect(() => { load() }, [load])
  const remove = async (product: Product) => {
    if (!window.confirm(`Delete "${product.name}" from inventory?`)) return
    try { await api(`/products/${product.id}`, token, { method: 'DELETE' }); notify('Product removed'); load() } catch (e) { notify(e instanceof Error ? e.message : 'Delete failed') }
  }
  return <div className="page-content"><PageHeading eyebrow="CATALOGUE" title="Inventory" subtitle="Keep your product catalogue and stock levels up to date." action={<button className="button primary" onClick={() => setModal('new')}><Plus size={17} /> Add product</button>} />
    <section className="panel table-panel"><div className="table-toolbar"><div><h3>Products <span className="count-badge">{products.length}</span></h3><p>Every item currently in your catalogue</p></div><label className="search-box"><Search size={16} /><input placeholder="Search name or barcode…" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
      {error && <div className="error-banner">{error}</div>}
      <div className="table-scroll"><table><thead><tr><th>PRODUCT</th><th>BARCODE</th><th>STOCK ON HAND</th><th>UNIT PRICE</th><th>STATUS</th><th /></tr></thead><tbody>{!busy && products.map(product => <tr key={product.id}><td><div className="product-cell">{product.image_url ? <img src={product.image_url} alt="" /> : <span className="product-placeholder"><Package size={17} /></span>}<span><b>{product.name}</b><small>SKU-{String(product.id).padStart(4, '0')}</small></span></div></td><td><span className="mono">{product.barcode}</span></td><td>{product.qty}</td><td><b>{money(product.price)}</b></td><td><span className={`stock-badge ${product.qty > 0 ? 'in-stock' : 'out-stock'}`}><i />{product.qty > 0 ? 'In stock' : 'Out of stock'}</span></td><td><div className="row-actions"><button title="Edit product" onClick={() => setModal(product)}><Settings size={15} /></button><button title="Delete product" onClick={() => remove(product)}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div>
      {busy ? <div className="table-loading">Loading products…</div> : products.length === 0 && <EmptyState icon={Boxes} title={search ? 'No matching products' : 'Your inventory is ready'} description={search ? 'Try a different product name or barcode.' : 'Add your first product to start building your catalogue.'} />}
      <div className="table-footer">Showing <b>{products.length}</b> product{products.length === 1 ? '' : 's'} <span>Stock is updated automatically after each sale</span></div>
    </section>
    {modal && <ProductModal token={token} initial={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); notify(modal === 'new' ? 'Product added to inventory' : 'Product updated'); load() }} />}
  </div>
}

function ProductModal({ token, initial, onClose, onSaved }: { token: string; initial: Product | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name || '')
  const [barcode, setBarcode] = useState(initial?.barcode || '')
  const [qty, setQty] = useState(initial ? String(initial.qty) : '')
  const [price, setPrice] = useState(initial ? String(initial.price) : '')
  const [imageUrl, setImageUrl] = useState(initial?.image_url || '')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      let finalImage = imageUrl
      if (file) {
        const form = new FormData()
        form.append('image', file)
        const result = await api<{ url: string }>('/uploads/image', token, { method: 'POST', body: form })
        finalImage = result.url
      }
      const payload = { name, barcode, qty: Number(qty), price: Number(price), image_url: finalImage || null }
      await api(initial ? `/products/${initial.id}` : '/products', token, { method: initial ? 'PUT' : 'POST', body: JSON.stringify(payload) })
      onSaved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save product') }
    finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><div className="modal"><div className="modal-head"><div><span className="eyebrow">PRODUCT CATALOGUE</span><h2>{initial ? 'Edit product' : 'Add a product'}</h2><p>Product name, barcode, stock and price are required.</p></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div><form className="modal-form" onSubmit={save}><label>Product name<input required maxLength={160} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Wireless mouse" /></label><label>Barcode<input required maxLength={100} value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="Scan or enter barcode" /></label><div className="form-row"><label>Quantity in stock<input required type="number" min="0" step="1" value={qty} onChange={e => setQty(e.target.value)} placeholder="Enter quantity" /></label><label>Unit price (Ks)<input required type="number" min="0.01" step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="Enter price" /></label></div><label>Product photo</label><div className="image-options"><label className="upload-choice"><Upload size={17} /><span>{file ? file.name : 'Upload from this device'}</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => setFile(e.target.files?.[0] || null)} /></label><span className="or">OR</span><input aria-label="Product photo URL" value={imageUrl} onChange={e => { setImageUrl(e.target.value); setFile(null) }} placeholder="Paste image URL" /></div>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Add product'}</button></div></form></div></div>
}

function SaleRecords({ token }: { token: string }) {
  const [period, setPeriod] = useState<Period>('day')
  const [date, setDate] = useState(today())
  const [sales, setSales] = useState<Sale[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const range = useMemo(() => dateRange(period, date), [period, date])
  useEffect(() => { api<{ sales: Sale[] }>(`/sales?from=${range.from}&to=${range.to}`, token).then(result => { setSales(result.sales); setError('') }).catch(e => setError(e.message)) }, [token, range])
  const filtered = sales.filter(sale => `${sale.receipt_no} ${sale.cashier} ${sale.payment_method}`.toLowerCase().includes(search.toLowerCase()))
  return <div className="page-content"><PageHeading eyebrow="TRANSACTIONS" title="Sale Record" subtitle="Review receipts, payment methods, and completed transactions." action={<div className="date-control"><select value={period} onChange={e => setPeriod(e.target.value as Period)}><option value="day">Day</option><option value="month">Month</option><option value="year">Year</option></select><input aria-label="Filter sales date" type={period === 'day' ? 'date' : period === 'month' ? 'month' : 'number'} value={period === 'year' ? date.slice(0, 4) : period === 'month' ? date.slice(0, 7) : date} onChange={e => setDate(period === 'year' ? `${e.target.value}-01-01` : period === 'month' ? `${e.target.value}-01` : e.target.value)} /></div>} />
    <section className="panel table-panel"><div className="table-toolbar"><div><h3>All transactions <span className="count-badge">{filtered.length}</span></h3><p>{range.from === range.to ? range.from : `${range.from} — ${range.to}`}</p></div><label className="search-box"><Search size={16} /><input placeholder="Search receipt or cashier…" value={search} onChange={e => setSearch(e.target.value)} /></label></div>{error && <div className="error-banner">{error}</div>}
      <div className="table-scroll"><table><thead><tr><th>RECEIPT</th><th>DATE & TIME</th><th>CASHIER</th><th>ITEMS</th><th>PAYMENT</th><th>TOTAL</th></tr></thead><tbody>{filtered.map(sale => <tr key={sale.id}><td><b className="mono receipt-no">{sale.receipt_no}</b></td><td>{new Date(sale.created_at).toLocaleString()}</td><td>{sale.cashier}</td><td>{sale.item_count}</td><td><span className={`method-badge ${sale.payment_method}`}>{sale.payment_method === 'cash' ? <CircleDollarSign size={13} /> : <Smartphone size={13} />}{sale.payment_method === 'cash' ? 'Cash' : sale.payment_method === 'kpay' ? 'KPay' : 'WavePay'}</span></td><td><b>{money(sale.total)}</b></td></tr>)}</tbody></table></div>
      {filtered.length === 0 && <EmptyState icon={ClipboardList} title="No sales for this period" description="Completed POS transactions will appear here automatically." />}
      <div className="table-footer">Showing <b>{filtered.length}</b> transaction{filtered.length === 1 ? '' : 's'} <span>Sales records are generated at checkout</span></div>
    </section></div>
}

function SettingsPage({ token, notify }: { token: string; notify: (message: string) => void }) {
  const [settings, setSettings] = useState<SettingsData>({ tax_rate: '', kpay_qr: '', wavepay_qr: '' })
  const [cashiers, setCashiers] = useState<Cashier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [cashierUsername, setCashierUsername] = useState('')
  const [cashierPassword, setCashierPassword] = useState('')
  const [showCashierPassword, setShowCashierPassword] = useState(false)
  const [resetCashier, setResetCashier] = useState<Cashier | null>(null)
  const [addingCashier, setAddingCashier] = useState(false)
  const loadCashiers = useCallback(async (): Promise<boolean> => {
    try {
      const result = await api<{ users: Cashier[] }>('/users', token)
      setCashiers(result.users)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load POS staff accounts')
      return false
    }
  }, [token])
  useEffect(() => {
    api<{ settings: SettingsData }>('/settings', token).then(result => setSettings(result.settings)).catch(e => setError(e.message)).finally(() => setLoading(false))
    loadCashiers()
  }, [token, loadCashiers])
  const uploadQr = async (method: 'kpay' | 'wavepay', file: File | undefined) => {
    if (!file) return
    try {
      const form = new FormData()
      form.append('image', file)
      const result = await api<{ url: string }>('/uploads/image', token, { method: 'POST', body: form })
      setSettings(current => ({ ...current, [`${method}_qr`]: result.url }))
    } catch (e) { setError(e instanceof Error ? e.message : 'QR upload failed') }
  }
  const saveSettings = async () => {
    setSaving(true); setError('')
    try { await api('/settings', token, { method: 'PUT', body: JSON.stringify(settings) }); notify('Settings saved') }
    catch (e) { setError(e instanceof Error ? e.message : 'Settings could not be saved') }
    finally { setSaving(false) }
  }
  const createCashier = async (event: React.FormEvent) => {
    event.preventDefault(); setAddingCashier(true); setError('')
    try {
      await api('/users', token, { method: 'POST', body: JSON.stringify({ username: cashierUsername, password: cashierPassword }) })
      setCashierUsername('')
      setCashierPassword('')
      setShowCashierPassword(false)
      loadCashiers()
      notify('POS account created')
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not create POS account') }
    finally { setAddingCashier(false) }
  }
  const setCashierActive = async (cashier: Cashier) => {
    const activate = !cashier.is_active
    const message = activate
      ? `Restore POS access for "${cashier.username}"?`
      : `Remove POS access for "${cashier.username}"? Their sales history will be kept.`
    if (!window.confirm(message)) return
    setError('')
    try {
      await api(`/users/${cashier.id}/status`, token, { method: 'PUT', body: JSON.stringify({ is_active: activate }) })
      if (!await loadCashiers()) return
      notify(activate ? 'Cashier access restored' : 'Cashier access removed')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update cashier access')
    }
  }
  const exportFile = async (kind: 'sales' | 'inventory') => {
    try {
      const response = await fetchApi(`/api/exports/${kind}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) {
        const data = await readJsonResponse(response)
        throw new Error(typeof data.error === 'string' ? data.error : `Export failed (${response.status})`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${kind}-${today()}.xlsx`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed') }
  }
  return <div className="page-content"><PageHeading eyebrow="STORE PREFERENCES" title="Settings" subtitle="Configure your tax, payment methods, and store tools." />
    {error && <div className="error-banner">{error}</div>}
    <div className="settings-layout"><div className="settings-main">
      <section className="panel settings-card"><div className="settings-section-heading"><span className="settings-icon"><CircleDollarSign size={19} /></span><div><h3>Tax adjustments</h3><p>Set the tax rate applied to each completed sale.</p></div></div><div className="tax-input-wrap"><label htmlFor="tax-rate">Sales tax rate</label><div className="percent-input"><input id="tax-rate" type="number" min="0" max="100" step="0.01" value={settings.tax_rate} onChange={e => setSettings({ ...settings, tax_rate: e.target.value })} placeholder="Enter percentage" /><span>%</span></div><small>Applied as a percentage to the subtotal. Enter 0 when no tax applies.</small></div></section>
      <section className="panel settings-card"><div className="settings-section-heading"><span className="settings-icon violet"><QrCode size={19} /></span><div><h3>Mobile banking QR codes</h3><p>Upload your store QR codes for display at checkout.</p></div></div><div className="qr-settings">{(['kpay', 'wavepay'] as const).map(method => <div className="qr-setting" key={method}><div><b>{method === 'kpay' ? 'KPay' : 'WavePay'}</b><small>Customer payment QR</small></div><label className="qr-upload">{settings[`${method}_qr`] ? <img src={settings[`${method}_qr`]} alt={`${method} payment QR`} /> : <span><Upload size={19} /><small>Upload QR</small></span>}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => uploadQr(method, e.target.files?.[0])} /></label></div>)}</div><p className="settings-hint"><ShieldCheck size={15} /> QR images are shown to the cashier during mobile banking checkout.</p></section>
      <section className="panel settings-card"><div className="settings-section-heading"><span className="settings-icon blue"><Users size={19} /></span><div><h3>POS staff access</h3><p>Create and manage POS staff sign-in accounts.</p></div></div><form className="cashier-form" onSubmit={createCashier}><label>Username<input required minLength={3} maxLength={80} pattern="[a-zA-Z0-9._-]+" value={cashierUsername} onChange={e => setCashierUsername(e.target.value)} placeholder="cashier01" /></label><label>Password<span className="password-field"><input required minLength={10} maxLength={200} type={showCashierPassword ? 'text' : 'password'} value={cashierPassword} onChange={e => setCashierPassword(e.target.value)} placeholder="At least 10 characters" /><button type="button" className="password-toggle" aria-label={showCashierPassword ? 'Hide password' : 'Show password'} onClick={() => setShowCashierPassword(show => !show)}>{showCashierPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label><div className="cashier-submit"><button className="button secondary" disabled={addingCashier}><Plus size={16} />Create POS account</button><small>Passwords are securely hashed and cannot be viewed later.</small></div></form><div className="cashier-table-wrap"><table className="cashier-table"><thead><tr><th>USERNAME</th><th>ACCESS</th><th>CREATED</th><th>PASSWORD</th><th>ACCOUNT</th><th /></tr></thead><tbody>{cashiers.map(cashier => <tr key={cashier.id}><td><b>{cashier.username}</b></td><td><span className="stock-badge in-stock"><i />POS cashier</span></td><td>{new Date(cashier.created_at).toLocaleDateString()}</td><td><span className="password-protected"><ShieldCheck size={14} />Protected</span></td><td><span className={`cashier-state ${cashier.is_active ? 'active' : 'inactive'}`}><i />{cashier.is_active ? 'Active' : 'Removed'}</span></td><td className="cashier-row-actions">{cashier.is_active && <button type="button" className="button secondary reset-password-button" onClick={() => setResetCashier(cashier)}><KeyRound size={14} />Reset</button>}<button type="button" className={`button secondary reset-password-button ${cashier.is_active ? 'remove-cashier-button' : 'restore-cashier-button'}`} onClick={() => setCashierActive(cashier)}>{cashier.is_active ? <><Trash2 size={14} />Remove</> : <><Users size={14} />Restore</>}</button></td></tr>)}</tbody></table>{cashiers.length === 0 && <div className="cashier-empty">No POS staff accounts yet.</div>}</div></section>
      <div className="save-settings"><span>Changes to tax and QR settings apply to new checkouts.</span><button className="button primary" onClick={saveSettings} disabled={loading || saving}>{saving ? 'Saving…' : 'Save settings'}</button></div>
    </div><aside className="settings-side"><section className="panel export-card"><span className="export-icon"><FileSpreadsheet size={19} /></span><h3>Export your data</h3><p>Download your store records as an Excel workbook.</p><button className="export-button" onClick={() => exportFile('sales')}><span><span className="xlsx-icon">X</span><span><b>Sale records</b><small>All completed transactions</small></span></span><ArrowDownToLine size={17} /></button><button className="export-button" onClick={() => exportFile('inventory')}><span><span className="xlsx-icon">X</span><span><b>Inventory</b><small>Your current product list</small></span></span><ArrowDownToLine size={17} /></button></section><section className="panel security-card"><ShieldCheck size={19} /><div><b>Your data, protected</b><p>Only administrators can change settings and access exports.</p></div></section></aside></div>
    {resetCashier && <ResetCashierPassword token={token} cashier={resetCashier} onClose={() => setResetCashier(null)} notify={notify} />}
  </div>
}

function ResetCashierPassword({ token, cashier, onClose, notify }: { token: string; cashier: Cashier; onClose: () => void; notify: (message: string) => void }) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      await api(`/users/${cashier.id}/password`, token, { method: 'PUT', body: JSON.stringify({ password }) })
      setSaved(true)
      notify(`Password reset for ${cashier.username}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reset password')
    } finally {
      setSaving(false)
    }
  }
  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(password)
      notify('New password copied')
    } catch {
      setError('Clipboard access is unavailable. Select and copy the password manually.')
    }
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose() }}><div className="modal reset-password-modal"><div className="modal-head"><div><span className="eyebrow">POS STAFF ACCESS</span><h2>{saved ? 'Password updated' : 'Reset password'}</h2><p>{saved ? `New password for ${cashier.username}. It will not be shown again after closing.` : `Set a new sign-in password for ${cashier.username}.`}</p></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div>{saved ? <div className="reset-password-result"><label>New password</label><div className="saved-password"><code>{password}</code><button type="button" className="icon-button" aria-label="Copy new password" onClick={copyPassword}><Copy size={16} /></button></div><p>Give this password to the cashier securely. This is the only time it can be viewed; it is stored as a secure hash.</p>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button primary" onClick={onClose}>Done</button></div></div> : <form className="modal-form" onSubmit={save}><label>New password<span className="password-field"><input autoComplete="new-password" required minLength={10} maxLength={200} type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="At least 10 characters" /><button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(show => !show)}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></label><p className="reset-password-note"><ShieldCheck size={15} />The password is hashed before saving and can only be shown once.</p>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button><button className="button primary" disabled={saving}>{saving ? 'Updating…' : 'Reset password'}</button></div></form>}</div></div>
}

function Pos({ token, user, logout, notify }: { token: string; user: User; logout: () => void; notify: (message: string) => void }) {
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<Line[]>([])
  const [barcode, setBarcode] = useState('')
  const [search, setSearch] = useState('')
  const [payment, setPayment] = useState<'cash' | 'kpay' | 'wavepay'>('cash')
  const [reference, setReference] = useState('')
  const [settings, setSettings] = useState<SettingsData>({ tax_rate: '', kpay_qr: '', wavepay_qr: '' })
  const [camera, setCamera] = useState(false)
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [error, setError] = useState('')
  const [dateLabel] = useState(() => new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))
  const barcodeRef = useRef<HTMLInputElement>(null)
  const filteredProducts = products.filter(product => `${product.name} ${product.barcode}`.toLowerCase().includes(search.toLowerCase()))
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.count, 0)
  const tax = subtotal * (Number(settings.tax_rate || 0) / 100)
  const total = subtotal + tax
  const reload = useCallback(() => { api<{ products: Product[] }>('/products', token).then(data => setProducts(data.products)).catch(e => setError(e.message)) }, [token])
  useEffect(() => { reload(); api<{ settings: SettingsData }>('/settings', token).then(result => setSettings(result.settings)).catch(e => setError(e.message)) }, [reload, token])
  const addProduct = (product: Product) => {
    setError('')
    setCart(current => {
      const found = current.find(item => item.id === product.id)
      if (found && found.count >= product.qty) { setError(`Only ${product.qty} in stock for ${product.name}`); return current }
      if (!found && product.qty < 1) { setError(`${product.name} is out of stock`); return current }
      return found ? current.map(item => item.id === product.id ? { ...item, count: item.count + 1 } : item) : [...current, { ...product, count: 1 }]
    })
    barcodeRef.current?.focus()
  }
  const addBarcode = (event: React.FormEvent) => {
    event.preventDefault()
    const product = products.find(item => item.barcode.toLowerCase() === barcode.trim().toLowerCase())
    if (product) { addProduct(product); setBarcode('') }
    else setError('No product matches that barcode. Check the barcode or add the product to inventory.')
    barcodeRef.current?.focus()
  }
  useEffect(() => {
    if (!camera) return
    let scanner: import('html5-qrcode').Html5Qrcode | null = null
    let cancelled = false
    const start = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode')
        if (cancelled) return
        scanner = new Html5Qrcode('camera-reader')
        await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 130 } }, decoded => {
          if (cancelled) return
          const product = products.find(item => item.barcode === decoded)
          if (product) { addProduct(product); setCamera(false); scanner?.stop().catch(() => {}) }
          else setError(`Scanned ${decoded}, but no product uses that barcode.`)
        }, () => {})
        if (cancelled && scanner.isScanning) await scanner.stop()
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? `Camera unavailable: ${e.message}` : 'Camera permission is required. Use HTTPS on mobile.')
          setCamera(false)
        }
      }
    }
    start()
    return () => {
      cancelled = true
      if (scanner?.isScanning) scanner.stop().catch(() => {})
    }
  }, [camera, products])
  const checkout = async () => {
    if (!cart.length || checkoutBusy) return
    if (payment !== 'cash' && !reference.trim()) { setError('Enter the mobile banking payment reference before completing checkout.'); return }
    setCheckoutBusy(true); setError('')
    try {
      const result = await api<{ receipt_no: string }>('/sales', token, { method: 'POST', body: JSON.stringify({ items: cart.map(item => ({ product_id: item.id, qty: item.count })), payment_method: payment, payment_reference: reference.trim() || null }) })
      setCart([]); setReference(''); reload(); notify(`Sale completed · ${result.receipt_no}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Checkout failed'); reload() }
    finally { setCheckoutBusy(false) }
  }
  return <div className="pos-screen"><header className="pos-header"><a className="brand" href="#" onClick={e => e.preventDefault()}><span className="brand-mark"><Star size={20} fill="currentColor" /></span><span>North Star<small>POS TERMINAL</small></span></a><span className="pos-live"><i /> Register active</span><div className="pos-account"><span className="top-avatar">{user.name.slice(0, 1).toUpperCase()}</span><span>{user.name}</span><button className="icon-button" title="Sign out" onClick={logout}><LogOut size={17} /></button></div></header>
    <div className="pos-body"><section className="pos-products"><div className="pos-page-heading"><div><span className="eyebrow">POINT OF SALE</span><h1>New sale</h1><p>Find a product or scan its barcode to add it to the cart.</p></div><span className="pos-date">{dateLabel}</span></div>
      <form className="barcode-search" onSubmit={addBarcode}><Barcode size={20} /><input ref={barcodeRef} value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="Type or scan a barcode…" autoFocus /><button type="submit" className="button primary">Add item</button><button type="button" className="scan-button" onClick={() => setCamera(true)}><Camera size={18} /><span>Scan</span></button></form>
      <div className="catalogue-heading"><h3>Product catalogue</h3><label className="search-box"><Search size={15} /><input placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
      <div className="pos-product-grid">{filteredProducts.map(product => <button className="pos-product-card" key={product.id} onClick={() => addProduct(product)} disabled={product.qty < 1}><div className="pos-product-image">{product.image_url ? <img src={product.image_url} alt="" /> : <Package size={25} />}<span className={product.qty > 0 ? 'available' : 'unavailable'}>{product.qty} in stock</span></div><span className="pos-product-info"><b>{product.name}</b><small>{product.barcode}</small><strong>{money(product.price)}</strong></span><span className="add-product"><Plus size={17} /></span></button>)}</div>
      {filteredProducts.length === 0 && <EmptyState icon={Package} title={products.length ? 'No matching products' : 'No products in inventory'} description={products.length ? 'Try searching by another name or barcode.' : 'An administrator needs to add products before checkout.'} />}
    </section><aside className="cart-panel"><div className="cart-header"><div><span className="eyebrow">CURRENT ORDER</span><h2>Shopping cart <span>{cart.reduce((sum, item) => sum + item.count, 0)}</span></h2></div><button className="clear-cart" onClick={() => setCart([])} disabled={!cart.length}>Clear</button></div><div className="cart-items">{cart.length ? cart.map(item => <div className="cart-item" key={item.id}><span className="cart-thumb">{item.image_url ? <img src={item.image_url} alt="" /> : <Package size={18} />}</span><div className="cart-item-info"><b>{item.name}</b><small>{money(item.price)} each</small><div className="quantity-control"><button aria-label="Decrease quantity" onClick={() => setCart(current => current.flatMap(line => line.id !== item.id ? [line] : line.count === 1 ? [] : [{ ...line, count: line.count - 1 }]))}><Minus size={12} /></button><span>{item.count}</span><button aria-label="Increase quantity" onClick={() => setCart(current => current.map(line => line.id === item.id && line.count < line.qty ? { ...line, count: line.count + 1 } : line))}><Plus size={12} /></button></div></div><b className="cart-line-total">{money(item.price * item.count)}</b></div>) : <div className="cart-empty"><span><ShoppingBag size={22} /></span><b>Your cart is empty</b><p>Choose a product or scan a barcode to start an order.</p></div>}</div>
      <div className="checkout-section"><div className="payment-select-heading"><b>Payment method</b></div><div className="payment-select">{(['cash', 'kpay', 'wavepay'] as const).map(method => <button key={method} className={payment === method ? 'selected' : ''} onClick={() => { setPayment(method); setReference('') }}><span>{method === 'cash' ? <CircleDollarSign size={17} /> : <Smartphone size={17} />}</span>{method === 'cash' ? 'Cash' : method === 'kpay' ? 'KPay' : 'WavePay'}</button>)}</div>
        {payment !== 'cash' && <div className="mobile-payment">{settings[`${payment}_qr`] ? <img className="checkout-qr" src={settings[`${payment}_qr`]} alt={`${payment} payment QR`} /> : <div className="qr-placeholder"><QrCode size={23} /><span>QR code not configured yet</span><small>Ask an administrator to add it in Settings.</small></div>}<label>Payment reference<input required value={reference} onChange={e => setReference(e.target.value)} placeholder="Enter transaction ID / reference" /></label></div>}
        {error && <div className="form-error checkout-error">{error}</div>}<div className="bill-summary"><div><span>Subtotal</span><span>{money(subtotal)}</span></div><div><span>Tax{settings.tax_rate ? ` (${settings.tax_rate}%)` : ''}</span><span>{money(tax)}</span></div><div className="bill-total"><b>Total due</b><b>{money(total)}</b></div></div><button className="button primary checkout-button" disabled={!cart.length || checkoutBusy} onClick={checkout}>{checkoutBusy ? 'Processing…' : <>Complete sale <ArrowRight size={17} /></>}</button><p className="secure-checkout"><ShieldCheck size={14} /> Sale records and stock update together</p>
      </div></aside></div>
    {camera && <div className="modal-backdrop"><div className="modal camera-modal"><div className="modal-head"><div><span className="eyebrow">BARCODE SCANNER</span><h2>Scan a product</h2><p>Allow camera access and point at the product barcode.</p></div><button className="icon-button" onClick={() => setCamera(false)}><X size={19} /></button></div><div id="camera-reader" /><p className="camera-tip"><Camera size={15} /> For phone cameras, open this page over HTTPS on the same Wi-Fi network.</p></div></div>}
  </div>
}

export default App

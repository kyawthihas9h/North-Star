import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import mysql from 'mysql2/promise'
import { z } from 'zod'
import ExcelJS from 'exceljs'

const root = path.dirname(fileURLToPath(import.meta.url))
const uploadDir = path.join(root, '..', 'uploads')
fs.mkdirSync(uploadDir, { recursive: true })

const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_NAME']
const missing = required.filter(key => !process.env[key])
if (missing.length) {
  console.error(`Missing MySQL connection settings: ${missing.join(', ')}. Copy .env.example to .env and configure it.`)
  process.exit(1)
}

const jwtSecretPath = path.join(root, '..', '.north-star-jwt-secret')
function loadJwtSecret() {
  try {
    const existing = fs.readFileSync(jwtSecretPath, 'utf8').trim()
    if (existing.length < 32) throw new Error('The saved JWT signing key is invalid. Remove .north-star-jwt-secret and restart to generate a new key; this will sign out all users.')
    return existing
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    const generated = crypto.randomBytes(48).toString('hex')
    try {
      fs.writeFileSync(jwtSecretPath, generated, { flag: 'wx', mode: 0o600 })
      console.info('Generated and saved a private JWT signing key.')
      return generated
    } catch (writeError) {
      if (writeError.code !== 'EEXIST') throw writeError
      return loadJwtSecret()
    }
  }
}
const jwtSecret = loadJwtSecret()

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: 10000,
  waitForConnections: true,
  connectionLimit: 12,
  queueLimit: 0,
  timezone: 'Z',
  decimalNumbers: true,
  charset: 'utf8mb4',
})
const app = express()
app.disable('x-powered-by')
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(cors({ origin: process.env.CORS_ORIGIN || false }))
app.use(express.json({ limit: '256kb' }))
app.use('/uploads', express.static(uploadDir, { maxAge: '1d', immutable: true }))
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false })
app.use('/api/auth/login', authLimiter)

const schema = {
  name: z.string().trim().min(1).max(160),
  barcode: z.string().trim().min(1).max(100),
  qty: z.number().int().min(0).max(100000000),
  price: z.number().positive().max(100000000000),
  image_url: z.union([z.string().url().max(2048), z.string().startsWith('/uploads/').max(2048), z.null()]).optional(),
}
const productInput = z.object(schema)
const parseInput = (shape, req, res) => {
  const result = shape.safeParse(req.body)
  if (!result.success) {
    res.status(400).json({ error: result.error.issues.map(issue => issue.message).join('; ') })
    return null
  }
  return result.data
}
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
const auth = async (req, res, next) => {
  const bearer = req.get('authorization')?.match(/^Bearer (.+)$/i)
  if (!bearer) return res.status(401).json({ error: 'Sign in is required.' })
  let identity
  try {
    identity = jwt.verify(bearer[1], jwtSecret)
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
  }
  const [users] = await pool.execute('SELECT is_active FROM users WHERE id=? LIMIT 1', [identity.id])
  if (!users.length || !users[0].is_active) return res.status(401).json({ error: 'This account is no longer active. Please contact an administrator.' })
  req.user = identity
  return next()
}
const allow = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have access to this action.' })
  return next()
}
const userSelect = user => ({ id: user.id, name: user.name, username: user.username, role: user.role })
const dateFilter = (req, res) => {
  const { from, to } = req.query
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  if ((from && !validDate(from)) || (to && !validDate(to))) {
    res.status(400).json({ error: 'Dates must use YYYY-MM-DD format.' })
    return null
  }
  if (from && to && from > to) {
    res.status(400).json({ error: 'The start date cannot be after the end date.' })
    return null
  }
  return { from: from || null, to: to || null }
}
const saleDateSql = `created_at >= COALESCE(?, '1000-01-01') AND created_at < COALESCE(DATE_ADD(?, INTERVAL 1 DAY), '9999-12-31')`

async function initialize() {
  const getColumns = async table => {
    const [columns] = await pool.execute(
      'SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [table],
    )
    return new Map(columns.map(column => [column.COLUMN_NAME, column.COLUMN_TYPE]))
  }
  const renameLegacyColumn = async (table, oldName, newName, definition) => {
    const columns = await getColumns(table)
    if (columns.has(oldName) && !columns.has(newName)) {
      await pool.query(`ALTER TABLE \`${table}\` CHANGE COLUMN \`${oldName}\` \`${newName}\` ${definition}`)
      console.info(`Migrated ${table}.${oldName} to ${newName}.`)
      return getColumns(table)
    }
    return columns
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      username VARCHAR(80) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin','cashier') NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `)
  let userColumns = await renameLegacyColumn('users', 'email', 'username', 'VARCHAR(254) NOT NULL')
  if (!userColumns.has('username') || !userColumns.has('password_hash') || !userColumns.has('role')) {
    throw new Error(`The existing users table is missing a required login column: ${['username', 'password_hash', 'role'].filter(column => !userColumns.has(column)).join(', ')}.`)
  }
  const nameColumnAdded = !userColumns.has('name')
  if (nameColumnAdded) {
    await pool.query('ALTER TABLE users ADD COLUMN name VARCHAR(120) NULL AFTER id')
    userColumns = await getColumns('users')
  }
  await pool.query("UPDATE users SET name = LEFT(username, 120) WHERE name IS NULL OR name = ''")
  if (userColumns.has('name') && userColumns.get('name') !== 'varchar(120)') {
    await pool.query('ALTER TABLE users MODIFY COLUMN name VARCHAR(120) NOT NULL')
  }
  if (nameColumnAdded) {
    console.info('Migrated existing users: added display names from usernames.')
  }
  if (userColumns.get('role')?.includes("'pos'")) {
    await pool.query("ALTER TABLE users MODIFY COLUMN role ENUM('admin','pos','cashier') NOT NULL")
    await pool.query("UPDATE users SET role = 'cashier' WHERE role = 'pos'")
    await pool.query("ALTER TABLE users MODIFY COLUMN role ENUM('admin','cashier') NOT NULL")
    console.info('Migrated existing POS accounts to the cashier role.')
  }
  if (!userColumns.has('is_active')) {
    await pool.query('ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER role')
    console.info('Migrated users table to support disabling and restoring cashier accounts.')
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      barcode VARCHAR(100) NOT NULL UNIQUE,
      image_url VARCHAR(2048) NULL,
      qty INT UNSIGNED NOT NULL,
      price DECIMAL(15,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_product_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      setting_key VARCHAR(80) NOT NULL PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `)
  const productColumns = await renameLegacyColumn('products', 'quantity', 'qty', 'INT UNSIGNED NOT NULL DEFAULT 0')
  if (!productColumns.has('qty')) {
    throw new Error('The products table is missing the quantity/qty stock column.')
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      receipt_no VARCHAR(48) NOT NULL UNIQUE,
      cashier_id BIGINT UNSIGNED NOT NULL,
      payment_method ENUM('cash','kpay','wavepay') NOT NULL,
      payment_reference VARCHAR(160) NULL,
      subtotal DECIMAL(15,2) NOT NULL,
      tax_rate DECIMAL(5,2) NOT NULL,
      tax DECIMAL(15,2) NOT NULL,
      total DECIMAL(15,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sale_created (created_at),
      INDEX idx_sale_payment (payment_method),
      CONSTRAINT fk_sale_cashier FOREIGN KEY (cashier_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `)
  let saleColumns = await renameLegacyColumn('sales', 'receipt_number', 'receipt_no', 'VARCHAR(48) NOT NULL')
  saleColumns = await renameLegacyColumn('sales', 'user_id', 'cashier_id', 'BIGINT UNSIGNED NOT NULL')
  saleColumns = await renameLegacyColumn('sales', 'tax_amount', 'tax', 'DECIMAL(15,2) NOT NULL')
  if (!saleColumns.has('payment_reference')) {
    await pool.query('ALTER TABLE sales ADD COLUMN payment_reference VARCHAR(160) NULL AFTER payment_method')
    saleColumns = await getColumns('sales')
    console.info('Migrated sales table with an optional mobile payment reference.')
  }
  const missingSaleColumns = ['receipt_no', 'cashier_id', 'payment_method', 'subtotal', 'tax_rate', 'tax', 'total', 'created_at']
    .filter(column => !saleColumns.has(column))
  if (missingSaleColumns.length) {
    throw new Error(`The existing sales table is missing required columns: ${missingSaleColumns.join(', ')}.`)
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sale_items (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      sale_id BIGINT UNSIGNED NOT NULL,
      product_id BIGINT UNSIGNED NOT NULL,
      product_name VARCHAR(160) NOT NULL,
      barcode VARCHAR(100) NOT NULL,
      qty INT UNSIGNED NOT NULL,
      unit_price DECIMAL(15,2) NOT NULL,
      line_total DECIMAL(15,2) NOT NULL,
      INDEX idx_sale_item_sale (sale_id),
      CONSTRAINT fk_item_sale FOREIGN KEY (sale_id) REFERENCES sales(id),
      CONSTRAINT fk_item_product FOREIGN KEY (product_id) REFERENCES products(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `)
  const saleItemColumns = await renameLegacyColumn('sale_items', 'quantity', 'qty', 'INT UNSIGNED NOT NULL')
  const missingSaleItemColumns = ['sale_id', 'product_id', 'product_name', 'barcode', 'qty', 'unit_price', 'line_total']
    .filter(column => !saleItemColumns.has(column))
  if (missingSaleItemColumns.length) {
    throw new Error(`The existing sale_items table is missing required columns: ${missingSaleItemColumns.join(', ')}.`)
  }
}

app.get('/api/auth/setup-status', asyncRoute(async (_req, res) => {
  const [admins] = await pool.execute('SELECT id FROM users WHERE role = ? LIMIT 1', ['admin'])
  return res.json({ setup_required: admins.length === 0 })
}))
app.post('/api/auth/setup', authLimiter, asyncRoute(async (req, res) => {
  const input = parseInput(z.object({
    username: z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9._-]+$/, 'Username may use letters, numbers, periods, underscores, and hyphens only.'),
    password: z.string().min(12).max(200),
  }), req, res)
  if (!input) return
  const connection = await pool.getConnection()
  let lockAcquired = false
  try {
    const [locks] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', ['north-star-admin-setup'])
    if (locks[0].acquired !== 1) return res.status(503).json({ error: 'Initial setup is busy. Please try again.' })
    lockAcquired = true
    const [admins] = await connection.execute('SELECT id FROM users WHERE role = ? LIMIT 1', ['admin'])
    if (admins.length) return res.status(409).json({ error: 'Administrator setup is already complete. Sign in instead.' })
    const passwordHash = await bcrypt.hash(input.password, 12)
    const [result] = await connection.execute('INSERT INTO users (name,username,password_hash,role) VALUES (?,?,?,?)', [input.username, input.username, passwordHash, 'admin'])
    const user = { id: result.insertId, name: input.username, username: input.username, role: 'admin' }
    const token = jwt.sign(user, jwtSecret, { expiresIn: '12h', issuer: 'north-star-pos' })
    return res.status(201).json({ token, user })
  } finally {
    if (lockAcquired) await connection.execute('SELECT RELEASE_LOCK(?)', ['north-star-admin-setup'])
    connection.release()
  }
}))
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const input = parseInput(z.object({ username: z.string().trim().min(3).max(80), password: z.string().min(1).max(200), mode: z.enum(['admin', 'cashier']) }), req, res)
  if (!input) return
  const [rows] = await pool.execute('SELECT id,name,username,password_hash,role,is_active FROM users WHERE username = ? LIMIT 1', [input.username])
  const user = rows[0]
  const valid = user && user.is_active && user.role === input.mode && await bcrypt.compare(input.password, user.password_hash)
  if (!valid) return res.status(401).json({ error: 'Username or password is incorrect for this workspace.' })
  const token = jwt.sign({ id: user.id, name: user.name, username: user.username, role: user.role }, jwtSecret, { expiresIn: '12h', issuer: 'north-star-pos' })
  return res.json({ token, user: userSelect(user) })
}))
app.get('/api/auth/me', auth, asyncRoute(async (req, res) => {
  const [rows] = await pool.execute('SELECT id,name,username,role FROM users WHERE id = ? LIMIT 1', [req.user.id])
  if (!rows.length) return res.status(401).json({ error: 'Account no longer exists.' })
  return res.json({ user: userSelect(rows[0]) })
}))

app.get('/api/products', auth, allow('admin', 'cashier'), asyncRoute(async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : ''
  const [products] = await pool.execute(
    `SELECT id,name,barcode,image_url,qty,price FROM products ${search ? 'WHERE name LIKE ? OR barcode LIKE ?' : ''} ORDER BY name ASC LIMIT 1000`,
    search ? [`%${search}%`, `%${search}%`] : [],
  )
  return res.json({ products })
}))
app.post('/api/products', auth, allow('admin'), asyncRoute(async (req, res) => {
  const input = parseInput(productInput, req, res)
  if (!input) return
  const [result] = await pool.execute('INSERT INTO products (name,barcode,image_url,qty,price) VALUES (?,?,?,?,?)', [input.name, input.barcode, input.image_url || null, input.qty, input.price])
  return res.status(201).json({ id: result.insertId })
}))
app.put('/api/products/:id', auth, allow('admin'), asyncRoute(async (req, res) => {
  const input = parseInput(productInput, req, res)
  if (!input) return
  const [result] = await pool.execute('UPDATE products SET name=?,barcode=?,image_url=?,qty=?,price=? WHERE id=?', [input.name, input.barcode, input.image_url || null, input.qty, input.price, req.params.id])
  if (!result.affectedRows) return res.status(404).json({ error: 'Product not found.' })
  return res.json({ updated: true })
}))
app.delete('/api/products/:id', auth, allow('admin'), asyncRoute(async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM products WHERE id=?', [req.params.id])
    if (!result.affectedRows) return res.status(404).json({ error: 'Product not found.' })
    return res.json({ deleted: true })
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ error: 'This product has completed sales and cannot be deleted. Set its stock to 0 instead.' })
    throw error
  }
}))

const imageStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDir),
  filename: (_req, file, callback) => {
    const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }
    callback(null, `${crypto.randomUUID()}${extensions[file.mimetype] || '.img'}`)
  },
})
const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }
    if (!extensions[file.mimetype]) return callback(new Error('Upload a PNG, JPG, WebP or GIF image.'))
    return callback(null, true)
  },
})
app.post('/api/uploads/image', auth, allow('admin'), imageUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an image file to upload.' })
  return res.status(201).json({ url: `/uploads/${req.file.filename}` })
})

app.get('/api/settings', auth, allow('admin', 'cashier'), asyncRoute(async (_req, res) => {
  const [rows] = await pool.execute('SELECT setting_key,setting_value FROM settings')
  const settings = Object.fromEntries(rows.map(row => [row.setting_key, row.setting_value]))
  return res.json({ settings: { tax_rate: settings.tax_rate ?? '', kpay_qr: settings.kpay_qr ?? '', wavepay_qr: settings.wavepay_qr ?? '' } })
}))
app.put('/api/settings', auth, allow('admin'), asyncRoute(async (req, res) => {
  const input = parseInput(z.object({
    tax_rate: z.union([z.literal(''), z.coerce.number().min(0).max(100)]),
    kpay_qr: z.string().max(2048),
    wavepay_qr: z.string().max(2048),
  }), req, res)
  if (!input) return
  for (const [key, value] of Object.entries(input)) {
    await pool.execute('INSERT INTO settings (setting_key,setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [key, String(value)])
  }
  return res.json({ saved: true })
}))
app.get('/api/users', auth, allow('admin'), asyncRoute(async (_req, res) => {
  const [users] = await pool.execute(
    'SELECT id,username,role,is_active,created_at FROM users WHERE role = ? ORDER BY is_active DESC,username',
    ['cashier'],
  )
  return res.json({ users })
}))
app.put('/api/users/:id/status', auth, allow('admin'), asyncRoute(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid cashier account.' })
  const input = parseInput(z.object({ is_active: z.boolean() }), req, res)
  if (!input) return
  const [users] = await pool.execute('SELECT role FROM users WHERE id=? LIMIT 1', [id])
  if (!users.length) return res.status(404).json({ error: 'Cashier account not found.' })
  if (users[0].role !== 'cashier') return res.status(403).json({ error: 'Only cashier accounts can be removed or restored here.' })
  await pool.execute('UPDATE users SET is_active=? WHERE id=?', [input.is_active, id])
  return res.json({ updated: true, is_active: input.is_active })
}))
app.post('/api/users', auth, allow('admin'), asyncRoute(async (req, res) => {
  const input = parseInput(z.object({ username: z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9._-]+$/, 'Username may use letters, numbers, periods, underscores, and hyphens only.'), password: z.string().min(10).max(200) }), req, res)
  if (!input) return
  const passwordHash = await bcrypt.hash(input.password, 12)
  const [result] = await pool.execute('INSERT INTO users (name,username,password_hash,role) VALUES (?,?,?,?)', [input.username, input.username, passwordHash, 'cashier'])
  return res.status(201).json({ id: result.insertId })
}))
app.put('/api/users/:id/password', auth, allow('admin'), asyncRoute(async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid cashier account.' })
  const input = parseInput(z.object({ password: z.string().min(10).max(200) }), req, res)
  if (!input) return
  const [users] = await pool.execute('SELECT id,role FROM users WHERE id=? LIMIT 1', [id])
  if (!users.length) return res.status(404).json({ error: 'Cashier account not found.' })
  if (users[0].role !== 'cashier') return res.status(403).json({ error: 'Only cashier passwords can be reset here.' })
  const passwordHash = await bcrypt.hash(input.password, 12)
  await pool.execute('UPDATE users SET password_hash=? WHERE id=?', [passwordHash, id])
  return res.json({ updated: true })
}))

app.post('/api/sales', auth, allow('admin', 'cashier'), asyncRoute(async (req, res) => {
  const input = parseInput(z.object({
    items: z.array(z.object({ product_id: z.coerce.number().int().positive(), qty: z.number().int().positive().max(100000) })).min(1).max(200),
    payment_method: z.enum(['cash', 'kpay', 'wavepay']),
    payment_reference: z.string().trim().max(160).nullable().optional(),
  }), req, res)
  if (!input) return
  if (input.payment_method !== 'cash' && !input.payment_reference?.trim()) return res.status(400).json({ error: 'A mobile banking payment reference is required.' })
  const quantities = new Map()
  for (const item of input.items) quantities.set(item.product_id, (quantities.get(item.product_id) || 0) + item.qty)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const productIds = [...quantities.keys()].sort((a, b) => a - b)
    const placeholders = productIds.map(() => '?').join(',')
    const [products] = await connection.execute(`SELECT id,name,barcode,qty,price FROM products WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`, productIds)
    if (products.length !== productIds.length) throw Object.assign(new Error('One or more cart products no longer exist. Refresh the register and try again.'), { status: 409 })
    let subtotal = 0
    const lines = products.map(product => {
      const qty = quantities.get(Number(product.id))
      if (product.qty < qty) throw Object.assign(new Error(`Insufficient stock for ${product.name}. Available: ${product.qty}.`), { status: 409 })
      const unitPrice = Number(product.price)
      const lineTotal = Math.round(unitPrice * qty * 100) / 100
      subtotal += lineTotal
      return { ...product, qty, unitPrice, lineTotal }
    })
    subtotal = Math.round(subtotal * 100) / 100
    const [settingRows] = await connection.execute('SELECT setting_value FROM settings WHERE setting_key=?', ['tax_rate'])
    const taxRate = settingRows.length ? Number(settingRows[0].setting_value) : 0
    const tax = Math.round(subtotal * taxRate) / 100
    const total = Math.round((subtotal + tax) * 100) / 100
    const receiptNo = `R-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
    const [saleResult] = await connection.execute(
      'INSERT INTO sales (receipt_no,cashier_id,payment_method,payment_reference,subtotal,tax_rate,tax,total) VALUES (?,?,?,?,?,?,?,?)',
      [receiptNo, req.user.id, input.payment_method, input.payment_reference?.trim() || null, subtotal, taxRate, tax, total],
    )
    for (const line of lines) {
      await connection.execute('INSERT INTO sale_items (sale_id,product_id,product_name,barcode,qty,unit_price,line_total) VALUES (?,?,?,?,?,?,?)', [saleResult.insertId, line.id, line.name, line.barcode, line.qty, line.unitPrice, line.lineTotal])
      await connection.execute('UPDATE products SET qty=qty-? WHERE id=?', [line.qty, line.id])
    }
    await connection.commit()
    return res.status(201).json({ id: saleResult.insertId, receipt_no: receiptNo, subtotal, tax, total })
  } catch (error) {
    await connection.rollback()
    if (error.status) return res.status(error.status).json({ error: error.message })
    throw error
  } finally {
    connection.release()
  }
}))

app.get('/api/sales', auth, allow('admin'), asyncRoute(async (req, res) => {
  const dates = dateFilter(req, res)
  if (!dates) return
  const [sales] = await pool.execute(
    `SELECT s.id,s.receipt_no,s.created_at,u.name AS cashier,s.payment_method,s.payment_reference,s.total,s.tax,COALESCE(SUM(i.qty),0) AS item_count FROM sales s JOIN users u ON u.id=s.cashier_id LEFT JOIN sale_items i ON i.sale_id=s.id WHERE s.created_at >= COALESCE(?, '1000-01-01') AND s.created_at < COALESCE(DATE_ADD(?, INTERVAL 1 DAY), '9999-12-31') GROUP BY s.id ORDER BY s.created_at DESC LIMIT 2000`,
    [dates.from, dates.to],
  )
  return res.json({ sales })
}))

app.get('/api/reports/summary', auth, allow('admin'), asyncRoute(async (req, res) => {
  const dates = dateFilter(req, res)
  if (!dates) return
  const period = req.query.period
  if (!['day', 'month', 'year'].includes(period)) return res.status(400).json({ error: 'Period must be day, month or year.' })
  const format = period === 'day' ? '%H:00' : period === 'month' ? '%e' : '%b'
  const [rows] = await pool.execute(
    `SELECT DATE_FORMAT(created_at, ?) AS period, payment_method, SUM(total) AS amount FROM sales WHERE ${saleDateSql} GROUP BY period,payment_method ORDER BY MIN(created_at)`,
    [format, dates.from, dates.to],
  )
  const map = new Map()
  for (const row of rows) {
    if (!map.has(row.period)) map.set(row.period, { period: row.period, cash: 0, kpay: 0, wavepay: 0, total: 0 })
    map.get(row.period)[row.payment_method] = Number(row.amount)
    map.get(row.period).total += Number(row.amount)
  }
  const [totals] = await pool.execute(
    `SELECT COUNT(*) AS orders,COALESCE(SUM(total),0) AS sales,COALESCE(SUM(CASE WHEN payment_method='cash' THEN total ELSE 0 END),0) AS cash,COALESCE(SUM(CASE WHEN payment_method='kpay' THEN total ELSE 0 END),0) AS kpay,COALESCE(SUM(CASE WHEN payment_method='wavepay' THEN total ELSE 0 END),0) AS wavepay FROM sales WHERE ${saleDateSql}`,
    [dates.from, dates.to],
  )
  const [itemTotals] = await pool.execute(`SELECT COALESCE(SUM(i.qty),0) AS items FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE ${saleDateSql}`, [dates.from, dates.to])
  if (period === 'day') {
    for (let hour = 0; hour < 24; hour++) {
      const label = `${String(hour).padStart(2, '0')}:00`
      if (!map.has(label)) map.set(label, { period: label, cash: 0, kpay: 0, wavepay: 0, total: 0 })
    }
  }
  const points = [...map.values()]
  if (period === 'day') points.sort((left, right) => Number(left.period.slice(0, 2)) - Number(right.period.slice(0, 2)))
  if (period === 'month') points.sort((left, right) => Number(left.period) - Number(right.period))
  return res.json({ points, summary: { ...totals[0], items: itemTotals[0].items } })
}))

app.get('/api/exports/sales', auth, allow('admin'), asyncRoute(async (_req, res) => {
  const [rows] = await pool.execute('SELECT s.receipt_no AS Receipt,s.created_at AS Date,u.name AS Cashier,s.payment_method AS Payment,s.payment_reference AS PaymentReference,s.subtotal AS Subtotal,s.tax_rate AS TaxRatePercent,s.tax AS Tax,s.total AS Total,COALESCE(SUM(i.qty),0) AS Items FROM sales s JOIN users u ON u.id=s.cashier_id LEFT JOIN sale_items i ON i.sale_id=s.id GROUP BY s.id ORDER BY s.created_at DESC')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Sale records')
  sheet.columns = rows.length ? Object.keys(rows[0]).map(key => ({ header: key, key, width: Math.min(Math.max(key.length + 4, 14), 28) })) : [{ header: 'Receipt', key: 'Receipt', width: 18 }]
  sheet.addRows(rows)
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`sale-records-${new Date().toISOString().slice(0, 10)}.xlsx`).send(buffer)
}))
app.get('/api/exports/inventory', auth, allow('admin'), asyncRoute(async (_req, res) => {
  const [rows] = await pool.execute('SELECT name AS Product,barcode AS Barcode,qty AS Quantity,price AS UnitPrice,image_url AS Image FROM products ORDER BY name')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Inventory')
  sheet.columns = rows.length ? Object.keys(rows[0]).map(key => ({ header: key, key, width: Math.min(Math.max(key.length + 4, 14), 28) })) : [{ header: 'Product', key: 'Product', width: 20 }]
  sheet.addRows(rows)
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment(`inventory-${new Date().toISOString().slice(0, 10)}.xlsx`).send(buffer)
}))

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Images must be 5 MB or smaller.' : 'The selected image could not be uploaded.' })
  if (error.message?.startsWith('Upload a ')) return res.status(400).json({ error: error.message })
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That username or barcode is already in use.' })
  console.error('Request failed:', error)
  return res.status(500).json({ error: 'The server could not complete that request. Check the server log for details.' })
})

const port = Number(process.env.PORT || 3001)
try {
  await initialize()
  app.listen(port, '0.0.0.0', () => console.info(`POS API listening on 0.0.0.0:${port}`))
} catch (error) {
  console.error('Could not initialize MySQL or create the administrator account:', error)
  await pool.end()
  process.exit(1)
}

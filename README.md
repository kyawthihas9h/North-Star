# North Star — Computer & Laptop Accessories POS

A React + TypeScript point-of-sale application with an Express API and MySQL storage. It includes separate administrator and cashier sign-ins, inventory, barcode checkout, sales reporting, payment QR codes, and Excel exports. A new installation starts with an empty catalogue, no sales, no QR images, and no configured tax rate.

## Requirements

- Node.js 20.19+ (or 22.12+) and npm
- MySQL 8.0+
- A browser with camera support for camera barcode scanning

## First-time setup (Windows PowerShell)

1. Open PowerShell in this project directory and install packages:

   ```powershell
   npm.cmd install
   ```

2. Run the complete database script, which creates the database and all POS tables. In MySQL Workbench, open `server/schema.sql` and execute it. Or, from Command Prompt in the project folder:

   ```bat
   mysql -u root -p < server\schema.sql
   ```

   Enter your MySQL password when prompted. The script is safe to run again; it creates missing tables without deleting data. The API also creates any missing tables when it starts. For a production server, create a dedicated MySQL account restricted to this database instead of using the MySQL root account.

3. Make a local environment file:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

   Set `DB_HOST`, `DB_PORT`, `DB_USER`, and `DB_NAME=north star` for your MySQL server; set `DB_PASSWORD` if your MySQL account has a password. `DB_PASSWORD` is only the credential for connecting to MySQL. The database name contains a space, so quote it with backticks in MySQL SQL statements. Admin usernames/passwords and the JWT secret are not needed in `.env`. Keep `.env private: it is excluded from Git. Never put database credentials in frontend code.

   The first time you open the app, it asks you to create an administrator username and password. The account is saved in MySQL, and the password is stored as a bcrypt hash. Once an administrator exists, public first-time setup is locked. Create cashier usernames and passwords from **Settings → POS staff access**. The API generates a private signing key in `.north-star-jwt-secret`; this file is excluded from Git. Keep it on the server and back it up securely—deleting it signs all active users out. On startup, existing databases are migrated to the current POS schema without deleting records: email usernames are retained, display names are filled from usernames when absent, `pos` roles become `cashier`, and legacy product/sales column names such as `quantity`, `receipt_number`, `user_id`, and `tax_amount` are migrated for the current API.

4. Start both the API and website:

   ```powershell
   npm.cmd run dev
   ```

   Open the local website at `http://localhost:5173`. The API listens on `http://localhost:3001`; Vite proxies API and uploaded-image requests.    The server exits with a clear message when required database settings are missing or the database connection fails.

5. Complete the first-time administrator setup in the app. Add products in **Inventory**; set tax and upload KPay/WavePay QR images under **Settings**. Create cashier usernames and passwords in **Settings → POS staff access**. Reset a cashier password there if needed; the new password is shown once after reset, while MySQL stores only its hash. Use **Remove** to disable a cashier's login without deleting their account or sales history; **Restore** re-enables it. Staff choose **POS terminal** on the sign-in page and use their own cashier credentials.

## Run on your local network

1. Connect the computer hosting this application and the phone/scanner to the same trusted Wi-Fi network. In Windows, run `ipconfig` and note the host computer's IPv4 address on that network, such as `192.168.1.25`.
2. Allow Node.js or TCP port `5173` through Windows Defender Firewall on the **Private** network profile only. Do not expose the development server, MySQL port `3306`, or API port `3001` to public networks/the internet. A sample PowerShell firewall rule (run as Administrator) is:

   ```powershell
   New-NetFirewallRule -DisplayName "Accessories POS (private LAN)" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow -Profile Private
   ```

3. With `npm run dev` running, use `http://<HOST-IP>:5173` from another computer on your LAN. Example: `http://192.168.1.25:5173`. If it does not load, check the selected Windows network profile, firewall, Wi-Fi client isolation, and that the devices are on the same subnet.
4. **Phone camera barcode scanning requires HTTPS.** Browsers block camera access on an ordinary `http://<LAN-IP>` origin. For trusted local HTTPS, install `mkcert` on the host and create a certificate for the host's actual LAN address:

   ```powershell
   mkcert -install
   New-Item -ItemType Directory -Force .cert
   mkcert -key-file .cert/pos-key.pem -cert-file .cert/pos.pem localhost 127.0.0.1 192.168.1.25
   $env:HTTPS_CERT_FILE = (Resolve-Path .cert/pos.pem).Path
   $env:HTTPS_KEY_FILE = (Resolve-Path .cert/pos-key.pem).Path
   npm run dev
   ```

   Replace `192.168.1.25` with your host's LAN address. Install and trust the mkcert **root CA certificate** on the scanning phone before opening `https://192.168.1.25:5173`; never copy or share `.cert/pos-key.pem`. On Android, install the CA certificate through the device security settings; on iPhone/iPad, install its profile and explicitly enable full trust. Device menus vary by OS version. A certificate warning means the browser may continue to block camera access.

For a public or multi-site production deployment, build the React client with `npm run build`, serve `dist/` through a production HTTPS reverse proxy, and proxy `/api` and `/uploads` to the API. Use a real TLS certificate, a dedicated MySQL account, private secrets, database backups, and firewall restrictions. Do not publish the Vite development server or expose MySQL directly to the internet.

## Workflows

- **Admin panel:** real MySQL-backed sales totals and payment charts with day/month/year filters; product create/edit/delete with unique barcodes, photo upload or image URL, quantity and price; searchable sale records; tax/QR configuration; cashier account creation; Excel (`.xlsx`) exports for sales and inventory.
- **POS terminal:** product search, barcode entry/scanner wedge, camera barcode scanning, quantity-aware cart, cash/KPay/WavePay selection, QR display and required mobile-payment reference, checkout, and atomic sale/stock updates.
- Mobile banking is recorded as a payment method and reference; this application does not connect to a bank or verify transfers automatically.
- Images uploaded from the device are stored under `uploads/` and served by the API. Back up this directory along with MySQL data.

## Production build

```powershell
npm run build
npm start
```

`npm start` starts the API after verifying that it can connect to MySQL and initialize its tables. The compiled frontend in `dist/` must be served by a web server/reverse proxy in production; configure that proxy to forward `/api` and `/uploads` to the API and serve the client for other routes.

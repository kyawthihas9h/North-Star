CREATE DATABASE IF NOT EXISTS `north star`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE `north star`;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  username VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'cashier') NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  barcode VARCHAR(100) NOT NULL,
  image_url VARCHAR(2048) NULL,
  qty INT UNSIGNED NOT NULL,
  price DECIMAL(15,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_barcode (barcode),
  KEY idx_product_name (name),
  CONSTRAINT chk_products_price_positive CHECK (price > 0)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS settings (
  setting_key VARCHAR(80) NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sales (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  receipt_no VARCHAR(48) NOT NULL,
  cashier_id BIGINT UNSIGNED NOT NULL,
  payment_method ENUM('cash', 'kpay', 'wavepay') NOT NULL,
  payment_reference VARCHAR(160) NULL,
  subtotal DECIMAL(15,2) NOT NULL,
  tax_rate DECIMAL(5,2) NOT NULL,
  tax DECIMAL(15,2) NOT NULL,
  total DECIMAL(15,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sales_receipt_no (receipt_no),
  KEY idx_sale_created (created_at),
  KEY idx_sale_payment (payment_method),
  CONSTRAINT fk_sale_cashier
    FOREIGN KEY (cashier_id) REFERENCES users (id),
  CONSTRAINT chk_sales_tax_rate CHECK (tax_rate >= 0 AND tax_rate <= 100),
  CONSTRAINT chk_sales_amounts CHECK (subtotal >= 0 AND tax >= 0 AND total >= 0)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sale_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sale_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  product_name VARCHAR(160) NOT NULL,
  barcode VARCHAR(100) NOT NULL,
  qty INT UNSIGNED NOT NULL,
  unit_price DECIMAL(15,2) NOT NULL,
  line_total DECIMAL(15,2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_sale_item_sale (sale_id),
  KEY idx_sale_item_product (product_id),
  CONSTRAINT fk_item_sale
    FOREIGN KEY (sale_id) REFERENCES sales (id),
  CONSTRAINT fk_item_product
    FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT chk_sale_items_qty CHECK (qty > 0),
  CONSTRAINT chk_sale_items_amounts CHECK (unit_price > 0 AND line_total >= 0)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci;

-- Create the first administrator in the app's one-time setup screen.
-- Account passwords are bcrypt-hashed by the API; never add credentials here.

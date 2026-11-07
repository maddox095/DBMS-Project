-- Additive: existing orders remain available without fabricated delivery details.
CREATE TABLE IF NOT EXISTS order_fulfillments (
    order_id BIGINT NOT NULL,
    contact_name VARCHAR(120) NOT NULL,
    email VARCHAR(254) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    company VARCHAR(160) NOT NULL,
    address_line VARCHAR(300) NOT NULL,
    city VARCHAR(100) NOT NULL,
    region VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    country VARCHAR(80) NOT NULL,
    delivery_method VARCHAR(8) NOT NULL,
    requested_date DATE NULL,
    tax_id VARCHAR(40) NOT NULL DEFAULT '',
    notes VARCHAR(2000) NOT NULL DEFAULT '',
    status VARCHAR(16) NOT NULL DEFAULT 'QUOTE_REQUESTED',
    unit_price DECIMAL(12,2) NULL,
    freight DECIMAL(12,2) NULL,
    tax_percent DECIMAL(5,2) NULL,
    subtotal DECIMAL(24,2) NULL,
    tax_amount DECIMAL(24,2) NULL,
    total DECIMAL(24,2) NULL,
    currency CHAR(3) NOT NULL DEFAULT 'INR',
    valid_until DATE NULL,
    terms VARCHAR(2000) NULL,
    quoted_at TIMESTAMP(6) NULL,
    confirmed_at TIMESTAMP(6) NULL,
    PRIMARY KEY (order_id),
    CONSTRAINT fk_fulfillment_order FOREIGN KEY (order_id)
      REFERENCES exchange_orders(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_fulfillment_method CHECK (delivery_method IN ('DELIVERY', 'PICKUP')),
    CONSTRAINT ck_fulfillment_status CHECK (status IN ('QUOTE_REQUESTED', 'QUOTED', 'CONFIRMED')),
    CONSTRAINT ck_fulfillment_quote CHECK (
      status = 'QUOTE_REQUESTED' OR
      (unit_price IS NOT NULL AND unit_price > 0 AND freight IS NOT NULL AND freight >= 0
       AND tax_percent IS NOT NULL AND tax_percent BETWEEN 0 AND 100
       AND subtotal IS NOT NULL AND subtotal > 0 AND tax_amount IS NOT NULL AND tax_amount >= 0
       AND total IS NOT NULL AND total > 0 AND valid_until IS NOT NULL AND terms IS NOT NULL
       AND quoted_at IS NOT NULL)
    ),
    CONSTRAINT ck_fulfillment_confirmed CHECK (status <> 'CONFIRMED' OR confirmed_at IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

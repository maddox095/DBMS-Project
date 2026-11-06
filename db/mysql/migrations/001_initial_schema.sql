CREATE TABLE IF NOT EXISTS organizations (
    id BIGINT NOT NULL AUTO_INCREMENT,
    name VARCHAR(160) NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT ck_organizations_name CHECK (CHAR_LENGTH(TRIM(name)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS materials (
    id BIGINT NOT NULL AUTO_INCREMENT,
    name VARCHAR(160) NOT NULL,
    category VARCHAR(80) NOT NULL,
    unit VARCHAR(16) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_materials_category_name (category, name),
    CONSTRAINT ck_materials_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
    CONSTRAINT ck_materials_category CHECK (CHAR_LENGTH(TRIM(category)) > 0),
    CONSTRAINT ck_materials_unit CHECK (CHAR_LENGTH(TRIM(unit)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS batches (
    id BIGINT NOT NULL AUTO_INCREMENT,
    supplier_org_id BIGINT NOT NULL,
    material_id BIGINT NOT NULL,
    batch_code VARCHAR(64) NOT NULL,
    description TEXT NOT NULL,
    location VARCHAR(160) NOT NULL,
    total_quantity DECIMAL(14,3) NOT NULL,
    status VARCHAR(9) COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'OPEN',
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_batches_supplier_code (supplier_org_id, batch_code),
    CONSTRAINT fk_batches_supplier FOREIGN KEY (supplier_org_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_batches_material FOREIGN KEY (material_id)
        REFERENCES materials (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_batches_code CHECK (CHAR_LENGTH(TRIM(batch_code)) > 0),
    CONSTRAINT ck_batches_location CHECK (CHAR_LENGTH(TRIM(location)) > 0),
    CONSTRAINT ck_batches_total_quantity CHECK (total_quantity > 0),
    CONSTRAINT ck_batches_status CHECK (status IN ('OPEN', 'CLOSED')),
    CONSTRAINT ck_batches_revision CHECK (revision > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reservations (
    id BIGINT NOT NULL AUTO_INCREMENT,
    batch_id BIGINT NOT NULL,
    recipient_org_id BIGINT NOT NULL,
    request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
    quantity DECIMAL(14,3) NOT NULL,
    status VARCHAR(9) COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_reservations_recipient_request (recipient_org_id, request_key),
    KEY ix_reservations_batch_status (batch_id, status),
    CONSTRAINT fk_reservations_batch FOREIGN KEY (batch_id)
        REFERENCES batches (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_reservations_recipient FOREIGN KEY (recipient_org_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_reservations_request_key CHECK (CHAR_LENGTH(request_key) = 36 AND IS_UUID(request_key)),
    CONSTRAINT ck_reservations_quantity CHECK (quantity > 0),
    CONSTRAINT ck_reservations_status CHECK (status IN ('ACTIVE', 'CANCELLED', 'CONVERTED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS exchange_orders (
    id BIGINT NOT NULL AUTO_INCREMENT,
    reservation_id BIGINT NOT NULL,
    placed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_exchange_orders_reservation (reservation_id),
    CONSTRAINT fk_exchange_orders_reservation FOREIGN KEY (reservation_id)
        REFERENCES reservations (id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS batch_index_events (
    id BIGINT NOT NULL AUTO_INCREMENT,
    batch_id BIGINT NOT NULL,
    batch_revision BIGINT NOT NULL,
    payload JSON NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    next_attempt_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    processed_at TIMESTAMP(6) NULL DEFAULT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_batch_index_events_revision (batch_id, batch_revision),
    KEY ix_batch_index_events_due (processed_at, next_attempt_at, id),
    CONSTRAINT fk_batch_index_events_batch FOREIGN KEY (batch_id)
        REFERENCES batches (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_batch_index_events_revision CHECK (batch_revision > 0),
    CONSTRAINT ck_batch_index_events_payload CHECK (JSON_TYPE(payload) = 'OBJECT')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

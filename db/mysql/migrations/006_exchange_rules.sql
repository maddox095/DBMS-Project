DELIMITER //

CREATE FUNCTION IF NOT EXISTS allocated_batch_quantity(p_batch_id BIGINT)
RETURNS DECIMAL(24,3)
READS SQL DATA
RETURN (
    SELECT COALESCE(SUM(quantity), 0)
    FROM reservations
    WHERE batch_id = p_batch_id AND status IN ('ACTIVE', 'CONVERTED')
)//

CREATE TRIGGER IF NOT EXISTS batches_before_insert
BEFORE INSERT ON batches FOR EACH ROW
BEGIN
    IF NOT EXISTS (SELECT 1 FROM organizations
                   WHERE id = NEW.supplier_org_id AND role = 'PRODUCER') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A batch supplier must be a producer';
    END IF;
END//

CREATE TRIGGER IF NOT EXISTS batches_before_update
BEFORE UPDATE ON batches FOR EACH ROW
BEGIN
    IF OLD.status = 'CLOSED' AND NEW.status = 'OPEN' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A closed batch cannot be reopened';
    END IF;
    IF NEW.total_quantity < OLD.total_quantity
       AND NEW.total_quantity < allocated_batch_quantity(OLD.id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Total quantity cannot fall below allocated stock';
    END IF;
END//

CREATE TRIGGER IF NOT EXISTS reservations_before_insert
BEFORE INSERT ON reservations FOR EACH ROW
BEGIN
    IF NOT EXISTS (SELECT 1 FROM organizations
                   WHERE id = NEW.recipient_org_id AND role = 'CONSUMER') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A reservation recipient must be a consumer';
    END IF;
    IF EXISTS (SELECT 1 FROM batches
               WHERE id = NEW.batch_id AND supplier_org_id = NEW.recipient_org_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A supplier cannot reserve its own batch';
    END IF;
END//

CREATE TRIGGER IF NOT EXISTS reservations_before_update
BEFORE UPDATE ON reservations FOR EACH ROW
BEGIN
    IF OLD.status <> NEW.status AND OLD.status <> 'ACTIVE' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A terminal reservation cannot change status';
    END IF;
END//

CREATE PROCEDURE IF NOT EXISTS record_supplier_quote(
    IN p_order_id BIGINT, IN p_supplier_org_id BIGINT,
    IN p_unit_price DECIMAL(12,2), IN p_freight DECIMAL(12,2),
    IN p_tax_percent DECIMAL(5,2), IN p_subtotal DECIMAL(24,2),
    IN p_tax_amount DECIMAL(24,2), IN p_total DECIMAL(24,2),
    IN p_valid_until DATE, IN p_terms VARCHAR(2000)
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
    UPDATE order_fulfillments f
    JOIN exchange_orders o ON o.id = f.order_id
    JOIN reservations r ON r.id = o.reservation_id
    JOIN batches b ON b.id = r.batch_id
    JOIN organizations supplier ON supplier.id = b.supplier_org_id
    SET f.status = 'QUOTED', f.unit_price = p_unit_price, f.freight = p_freight,
        f.tax_percent = p_tax_percent, f.subtotal = p_subtotal,
        f.tax_amount = p_tax_amount, f.total = p_total,
        f.valid_until = p_valid_until, f.terms = p_terms, f.quoted_at = CURRENT_TIMESTAMP(6)
    WHERE f.order_id = p_order_id AND b.supplier_org_id = p_supplier_org_id
      AND supplier.role = 'PRODUCER' AND f.status = 'QUOTE_REQUESTED'
      AND p_valid_until >= UTC_DATE();

    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Order is ineligible for a supplier quotation';
    END IF;
END//

CREATE PROCEDURE IF NOT EXISTS confirm_recipient_order(
    IN p_order_id BIGINT, IN p_recipient_org_id BIGINT
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
    UPDATE order_fulfillments f
    JOIN exchange_orders o ON o.id = f.order_id
    JOIN reservations r ON r.id = o.reservation_id
    JOIN organizations recipient ON recipient.id = r.recipient_org_id
    SET f.status = 'CONFIRMED', f.confirmed_at = CURRENT_TIMESTAMP(6)
    WHERE f.order_id = p_order_id AND r.recipient_org_id = p_recipient_org_id
      AND recipient.role = 'CONSUMER' AND f.status = 'QUOTED'
      AND f.valid_until >= UTC_DATE();

    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Order is ineligible for recipient confirmation';
    END IF;
END//

DELIMITER ;

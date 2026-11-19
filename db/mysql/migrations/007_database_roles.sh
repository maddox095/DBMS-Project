#!/usr/bin/env bash

(
    set -eu

    if [[ ! ${MYSQL_DATABASE:-} =~ ^[A-Za-z0-9_]+$ ]]; then
        echo 'MYSQL_DATABASE must contain only letters, digits and underscores.' >&2
        exit 1
    fi
    case ${MYSQL_USER:-} in
        exchange_auth|exchange_producer|exchange_consumer|exchange_worker)
            echo 'MYSQL_USER must differ from the four runtime account names.' >&2
            exit 1
            ;;
    esac

    for variable in MYSQL_AUTH_PASSWORD MYSQL_PRODUCER_PASSWORD MYSQL_CONSUMER_PASSWORD MYSQL_WORKER_PASSWORD; do
        if [[ ! ${!variable:-} =~ ^[A-Za-z0-9_-]{16,128}$ ]]; then
            echo "$variable must contain 16–128 letters, digits, underscores or hyphens." >&2
            exit 1
        fi
    done

    schema="\`${MYSQL_DATABASE}\`"
    # The accounts and roles are scoped to this dedicated MySQL instance.
    MYSQL_PWD="${MYSQL_ROOT_PASSWORD:?Set MYSQL_ROOT_PASSWORD}" mysql --protocol=socket -u root <<SQL
CREATE ROLE IF NOT EXISTS exchange_reader_role, exchange_auth_role, exchange_producer_role,
    exchange_consumer_role, exchange_worker_role;

CREATE USER IF NOT EXISTS 'exchange_auth'@'%' IDENTIFIED BY '${MYSQL_AUTH_PASSWORD}';
CREATE USER IF NOT EXISTS 'exchange_producer'@'%' IDENTIFIED BY '${MYSQL_PRODUCER_PASSWORD}';
CREATE USER IF NOT EXISTS 'exchange_consumer'@'%' IDENTIFIED BY '${MYSQL_CONSUMER_PASSWORD}';
CREATE USER IF NOT EXISTS 'exchange_worker'@'%' IDENTIFIED BY '${MYSQL_WORKER_PASSWORD}';
ALTER USER 'exchange_auth'@'%' IDENTIFIED BY '${MYSQL_AUTH_PASSWORD}';
ALTER USER 'exchange_producer'@'%' IDENTIFIED BY '${MYSQL_PRODUCER_PASSWORD}';
ALTER USER 'exchange_consumer'@'%' IDENTIFIED BY '${MYSQL_CONSUMER_PASSWORD}';
ALTER USER 'exchange_worker'@'%' IDENTIFIED BY '${MYSQL_WORKER_PASSWORD}';

GRANT SELECT ON ${schema}.organizations TO exchange_reader_role;
GRANT SELECT ON ${schema}.materials TO exchange_reader_role, exchange_worker_role;
GRANT SELECT ON ${schema}.batches TO exchange_reader_role, exchange_worker_role;
GRANT SELECT ON ${schema}.reservations TO exchange_reader_role, exchange_worker_role;
GRANT SELECT ON ${schema}.exchange_orders TO exchange_reader_role;
GRANT SELECT ON ${schema}.order_fulfillments TO exchange_reader_role;

GRANT SELECT, INSERT (name, role) ON ${schema}.organizations TO exchange_auth_role;
GRANT INSERT ON ${schema}.auth_organization_names TO exchange_auth_role;
GRANT SELECT, INSERT (organization_id, full_name, email, password_hash) ON ${schema}.auth_users TO exchange_auth_role;
GRANT SELECT, INSERT, DELETE, UPDATE (last_seen_at) ON ${schema}.auth_sessions TO exchange_auth_role;
GRANT SELECT, INSERT, DELETE, UPDATE (attempts) ON ${schema}.auth_rate_limits TO exchange_auth_role;

GRANT INSERT (supplier_org_id, material_id, batch_code, description, location, total_quantity),
    UPDATE (description, location, total_quantity, status, revision)
    ON ${schema}.batches TO exchange_producer_role;
GRANT UPDATE (revision) ON ${schema}.batches TO exchange_consumer_role;
GRANT INSERT (batch_id, recipient_org_id, request_key, quantity), UPDATE (status)
    ON ${schema}.reservations TO exchange_consumer_role;
GRANT INSERT (reservation_id) ON ${schema}.exchange_orders TO exchange_consumer_role;
GRANT INSERT (order_id, contact_name, email, phone, company, address_line, city, region,
    postal_code, country, delivery_method, requested_date, tax_id, notes)
    ON ${schema}.order_fulfillments TO exchange_consumer_role;
GRANT INSERT (batch_id, batch_revision, payload)
    ON ${schema}.batch_index_events TO exchange_producer_role, exchange_consumer_role;
GRANT SELECT, UPDATE (processed_at, attempts, next_attempt_at)
    ON ${schema}.batch_index_events TO exchange_worker_role;
GRANT EXECUTE ON PROCEDURE ${schema}.record_supplier_quote TO exchange_producer_role;
GRANT EXECUTE ON PROCEDURE ${schema}.confirm_recipient_order TO exchange_consumer_role;

GRANT exchange_reader_role TO exchange_producer_role, exchange_consumer_role;
GRANT exchange_auth_role TO 'exchange_auth'@'%';
GRANT exchange_producer_role TO 'exchange_producer'@'%';
GRANT exchange_consumer_role TO 'exchange_consumer'@'%';
GRANT exchange_worker_role TO 'exchange_worker'@'%';
SET DEFAULT ROLE exchange_auth_role TO 'exchange_auth'@'%';
SET DEFAULT ROLE exchange_producer_role TO 'exchange_producer'@'%';
SET DEFAULT ROLE exchange_consumer_role TO 'exchange_consumer'@'%';
SET DEFAULT ROLE exchange_worker_role TO 'exchange_worker'@'%';
SQL
)

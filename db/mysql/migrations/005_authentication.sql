CREATE TABLE IF NOT EXISTS auth_organization_names (
    name_key VARCHAR(160) COLLATE utf8mb4_0900_as_cs NOT NULL,
    organization_id BIGINT NOT NULL,
    PRIMARY KEY (name_key),
    UNIQUE KEY uq_auth_organization_name_id (organization_id),
    CONSTRAINT fk_auth_name_organization FOREIGN KEY (organization_id)
      REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Reserve existing names without creating public credentials or claiming records.
INSERT INTO auth_organization_names (name_key, organization_id)
SELECT LOWER(TRIM(REGEXP_REPLACE(name, '[[:space:]]+', ' '))), id
FROM organizations ORDER BY id
ON DUPLICATE KEY UPDATE name_key = auth_organization_names.name_key;

CREATE TABLE IF NOT EXISTS auth_users (
    id BIGINT NOT NULL AUTO_INCREMENT,
    organization_id BIGINT NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(254) COLLATE utf8mb4_0900_as_cs NOT NULL,
    password_hash VARCHAR(256) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    disabled_at TIMESTAMP(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_auth_users_email (email),
    KEY ix_auth_users_organization (organization_id),
    CONSTRAINT fk_auth_user_organization FOREIGN KEY (organization_id)
      REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash BINARY(32) NOT NULL,
    user_id BIGINT NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_seen_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (token_hash),
    KEY ix_auth_sessions_user (user_id),
    KEY ix_auth_sessions_expiry (expires_at),
    CONSTRAINT fk_auth_session_user FOREIGN KEY (user_id)
      REFERENCES auth_users(id) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
    bucket_hash BINARY(32) NOT NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 1,
    expires_at TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (bucket_hash),
    KEY ix_auth_rate_limits_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

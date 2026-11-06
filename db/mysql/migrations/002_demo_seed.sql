START TRANSACTION;

-- Stable demo identities for one supplier and two recipients.
INSERT INTO organizations (id, name) VALUES
    (1, 'Deccan Thermal Works'),
    (2, 'Bengaluru Cement Lab'),
    (3, 'Kaveri Materials Cooperative')
ON DUPLICATE KEY UPDATE id = organizations.id;

INSERT INTO materials (name, category, unit) VALUES
    ('Fly ash', 'Mineral residues', 'kg'),
    ('Blast furnace slag', 'Mineral residues', 'kg'),
    ('Spent foundry sand', 'Foundry residues', 'kg'),
    ('Recovered cutting fluid', 'Process fluids', 'L')
ON DUPLICATE KEY UPDATE id = materials.id;

COMMIT;

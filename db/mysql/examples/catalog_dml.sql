-- Run as the schema administrator. The fixture and every change roll back.
START TRANSACTION;
SET @demo_name = CONCAT('Rubric fixture ', UUID());

INSERT INTO materials (name, category, unit)
VALUES (@demo_name, 'Verification', 'kg');
SET @demo_material = LAST_INSERT_ID();

SELECT id, name, category, unit FROM materials WHERE id = @demo_material;

UPDATE materials SET category = 'SQL verification' WHERE id = @demo_material;
SELECT id, name, category, unit FROM materials WHERE id = @demo_material;

DELETE FROM materials WHERE id = @demo_material;
SELECT COUNT(*) AS rows_after_delete FROM materials WHERE id = @demo_material;

ROLLBACK;

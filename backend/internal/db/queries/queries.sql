-- name: CreateAssignment :one
INSERT INTO assignments (title)
VALUES (nullif(sqlc.arg(title), ''))
RETURNING id, user_id, title, status, created_at, updated_at;

-- name: GetAssignment :one
SELECT id, user_id, title, status, created_at, updated_at
FROM assignments
WHERE id = sqlc.arg(id);

-- name: GetImageByAssignmentID :one
SELECT id, assignment_id, original_filename, stored_path, mime_type, size_bytes, created_at
FROM assignment_images
WHERE assignment_id = sqlc.arg(assignment_id)
ORDER BY created_at DESC
LIMIT 1;

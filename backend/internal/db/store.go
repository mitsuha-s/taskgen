package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

var ErrNotFound = errors.New("not found")

type Store struct {
	pool *pgxpool.Pool
}

type Assignment struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Title     string    `json:"title"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AssignmentImage struct {
	ID               string    `json:"id"`
	AssignmentID     string    `json:"assignment_id"`
	OriginalFilename string    `json:"original_filename"`
	StoredPath       string    `json:"stored_path"`
	MimeType         string    `json:"mime_type"`
	SizeBytes        int64     `json:"size_bytes"`
	CreatedAt        time.Time `json:"created_at"`
}

type ExtractionRun struct {
	ID            string          `json:"id"`
	AssignmentID  string          `json:"assignment_id"`
	Status        string          `json:"status"`
	CurrentStep   int             `json:"current_step"`
	Provider      string          `json:"provider,omitempty"`
	Model         string          `json:"model,omitempty"`
	PromptVersion string          `json:"prompt_version,omitempty"`
	RawResponse   string          `json:"-"`
	ParsedContent json.RawMessage `json:"parsed_content"`
	StepResults   json.RawMessage `json:"step_results"`
	Warnings      json.RawMessage `json:"warnings"`
	ErrorMessage  string          `json:"error_message,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	StartedAt     *time.Time      `json:"started_at,omitempty"`
	FinishedAt    *time.Time      `json:"finished_at,omitempty"`
}

type ImageInput struct {
	OriginalFilename string
	StoredPath       string
	MimeType         string
	SizeBytes        int64
}

func Open(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func RunMigrations(databaseURL, migrationsDir string) error {
	sqlDB, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return err
	}
	defer sqlDB.Close()

	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.Up(sqlDB, migrationsDir)
}

func (s *Store) Close() {
	s.pool.Close()
}

func (s *Store) CreateAssignment(ctx context.Context, title string) (Assignment, error) {
	row := s.pool.QueryRow(ctx, `
		INSERT INTO assignments (title)
		VALUES (nullif($1, ''))
		RETURNING id::text, user_id, coalesce(title, ''), status, created_at, updated_at
	`, title)
	return scanAssignment(row)
}

func (s *Store) GetAssignment(ctx context.Context, id string) (Assignment, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id::text, user_id, coalesce(title, ''), status, created_at, updated_at
		FROM assignments
		WHERE id = $1
	`, id)
	return scanAssignment(row)
}

func (s *Store) UpdateAssignmentStatus(ctx context.Context, id, status string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE assignments
		SET status = $2
		WHERE id = $1
	`, id, status)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) SaveAssignmentImage(ctx context.Context, assignmentID string, input ImageInput) (AssignmentImage, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AssignmentImage{}, err
	}
	defer tx.Rollback(ctx)

	var image AssignmentImage
	row := tx.QueryRow(ctx, `
		INSERT INTO assignment_images (
			assignment_id, original_filename, stored_path, mime_type, size_bytes
		)
		VALUES ($1, nullif($2, ''), $3, $4, $5)
		ON CONFLICT (assignment_id) DO UPDATE SET
			original_filename = excluded.original_filename,
			stored_path = excluded.stored_path,
			mime_type = excluded.mime_type,
			size_bytes = excluded.size_bytes,
			created_at = now()
		RETURNING id::text, assignment_id::text, coalesce(original_filename, ''),
			stored_path, mime_type, size_bytes, created_at
	`, assignmentID, input.OriginalFilename, input.StoredPath, input.MimeType, input.SizeBytes)
	if err := row.Scan(
		&image.ID,
		&image.AssignmentID,
		&image.OriginalFilename,
		&image.StoredPath,
		&image.MimeType,
		&image.SizeBytes,
		&image.CreatedAt,
	); err != nil {
		return AssignmentImage{}, mapNoRows(err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE assignments
		SET status = 'image_uploaded'
		WHERE id = $1
	`, assignmentID); err != nil {
		return AssignmentImage{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return AssignmentImage{}, err
	}
	return image, nil
}

func (s *Store) GetImageByAssignmentID(ctx context.Context, assignmentID string) (AssignmentImage, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id::text, assignment_id::text, coalesce(original_filename, ''),
			stored_path, mime_type, size_bytes, created_at
		FROM assignment_images
		WHERE assignment_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, assignmentID)
	return scanAssignmentImage(row)
}

func (s *Store) CreateExtractionRun(ctx context.Context, assignmentID, promptVersion, provider string) (ExtractionRun, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ExtractionRun{}, err
	}
	defer tx.Rollback(ctx)

	row := tx.QueryRow(ctx, `
		INSERT INTO extraction_runs (assignment_id, prompt_version, provider)
		VALUES ($1, $2, nullif($3, ''))
		RETURNING id::text, assignment_id::text, status, current_step, coalesce(provider, ''),
			coalesce(model, ''), coalesce(prompt_version, ''), coalesce(raw_response, ''),
			coalesce(parsed_content::text, 'null'), coalesce(step_results::text, '[]'),
			coalesce(warnings::text, '[]'),
			coalesce(error_message, ''), created_at, started_at, finished_at
	`, assignmentID, promptVersion, provider)
	run, err := scanExtractionRun(row)
	if err != nil {
		return ExtractionRun{}, mapNoRows(err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE assignments
		SET status = 'extracting'
		WHERE id = $1
	`, assignmentID); err != nil {
		return ExtractionRun{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return ExtractionRun{}, err
	}
	return run, nil
}

func (s *Store) MarkExtractionRunning(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE extraction_runs
		SET status = 'running', started_at = coalesce(started_at, now())
		WHERE id = $1
	`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) MarkExtractionStepRunning(ctx context.Context, id string, step int) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE extraction_runs
		SET status = 'running',
			current_step = $2,
			started_at = coalesce(started_at, now()),
			finished_at = null,
			error_message = null
		WHERE id = $1
	`, id, step)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) FinishExtractionSucceeded(ctx context.Context, id, provider, model, promptVersion, rawResponse string, parsedContent, warnings json.RawMessage) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var assignmentID string
	if err := tx.QueryRow(ctx, `
		UPDATE extraction_runs
		SET status = 'succeeded',
			provider = $2,
			model = $3,
			prompt_version = $4,
			raw_response = $5,
			parsed_content = $6::jsonb,
			warnings = $7::jsonb,
			error_message = null,
			finished_at = now()
		WHERE id = $1
		RETURNING assignment_id::text
	`, id, provider, model, promptVersion, rawResponse, string(parsedContent), string(warnings)).Scan(&assignmentID); err != nil {
		return mapNoRows(err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE assignments
		SET status = 'extracted'
		WHERE id = $1
	`, assignmentID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

type ExtractionStepFinishInput struct {
	Status           string
	AssignmentStatus string
	Provider         string
	Model            string
	PromptVersion    string
	RawResponse      string
	CurrentStep      int
	StepResults      json.RawMessage
	ParsedContent    json.RawMessage
	Warnings         json.RawMessage
}

func (s *Store) FinishExtractionStep(ctx context.Context, id string, input ExtractionStepFinishInput) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var assignmentID string
	if err := tx.QueryRow(ctx, `
		UPDATE extraction_runs
		SET status = $2,
			provider = nullif($3, ''),
			model = nullif($4, ''),
			prompt_version = $5,
			raw_response = nullif($6, ''),
			current_step = $7,
			step_results = $8::jsonb,
			parsed_content = $9::jsonb,
			warnings = $10::jsonb,
			error_message = null,
			finished_at = CASE WHEN $2 = 'succeeded' THEN now() ELSE null END
		WHERE id = $1
		RETURNING assignment_id::text
	`, id, input.Status, input.Provider, input.Model, input.PromptVersion, input.RawResponse,
		input.CurrentStep, string(input.StepResults), string(input.ParsedContent), string(input.Warnings)).Scan(&assignmentID); err != nil {
		return mapNoRows(err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE assignments
		SET status = $2
		WHERE id = $1
	`, assignmentID, input.AssignmentStatus); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *Store) UpdateExtractionStepResults(ctx context.Context, id string, status, assignmentStatus string, currentStep int, stepResults, parsedContent json.RawMessage) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var assignmentID string
	if err := tx.QueryRow(ctx, `
		UPDATE extraction_runs
		SET status = $2,
			current_step = $3,
			step_results = $4::jsonb,
			parsed_content = $5::jsonb,
			error_message = null,
			finished_at = CASE WHEN $2 = 'succeeded' THEN now() ELSE null END
		WHERE id = $1
		RETURNING assignment_id::text
	`, id, status, currentStep, string(stepResults), string(parsedContent)).Scan(&assignmentID); err != nil {
		return mapNoRows(err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE assignments
		SET status = $2
		WHERE id = $1
	`, assignmentID, assignmentStatus); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *Store) FinishExtractionFailed(ctx context.Context, id, provider, model, promptVersion, rawResponse, errorMessage string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var assignmentID string
	if err := tx.QueryRow(ctx, `
		UPDATE extraction_runs
		SET status = 'failed',
			provider = nullif($2, ''),
			model = nullif($3, ''),
			prompt_version = nullif($4, ''),
			raw_response = nullif($5, ''),
			error_message = $6,
			finished_at = now()
		WHERE id = $1
		RETURNING assignment_id::text
	`, id, provider, model, promptVersion, rawResponse, errorMessage).Scan(&assignmentID); err != nil {
		return mapNoRows(err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE assignments
		SET status = 'extraction_failed'
		WHERE id = $1
	`, assignmentID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (s *Store) GetExtractionRun(ctx context.Context, id string) (ExtractionRun, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id::text, assignment_id::text, status, current_step, coalesce(provider, ''),
			coalesce(model, ''), coalesce(prompt_version, ''), coalesce(raw_response, ''),
			coalesce(parsed_content::text, 'null'), coalesce(step_results::text, '[]'),
			coalesce(warnings::text, '[]'),
			coalesce(error_message, ''), created_at, started_at, finished_at
		FROM extraction_runs
		WHERE id = $1
	`, id)
	return scanExtractionRun(row)
}

func (s *Store) GetLatestExtractionRunForAssignment(ctx context.Context, assignmentID string) (ExtractionRun, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT id::text, assignment_id::text, status, current_step, coalesce(provider, ''),
			coalesce(model, ''), coalesce(prompt_version, ''), coalesce(raw_response, ''),
			coalesce(parsed_content::text, 'null'), coalesce(step_results::text, '[]'),
			coalesce(warnings::text, '[]'),
			coalesce(error_message, ''), created_at, started_at, finished_at
		FROM extraction_runs
		WHERE assignment_id = $1
		ORDER BY created_at DESC
		LIMIT 1
	`, assignmentID)
	return scanExtractionRun(row)
}

type LLMRunInput struct {
	TaskType      string
	Provider      string
	Model         string
	PromptVersion string
	Input         json.RawMessage
	RawOutput     string
	ParsedOutput  json.RawMessage
	Status        string
	ErrorMessage  string
}

func (s *Store) InsertLLMRun(ctx context.Context, input LLMRunInput) error {
	parsed := ""
	if len(input.ParsedOutput) > 0 {
		parsed = string(input.ParsedOutput)
	}

	_, err := s.pool.Exec(ctx, `
		INSERT INTO llm_runs (
			task_type, provider, model, prompt_version, input, raw_output,
			parsed_output, status, error_message, finished_at
		)
		VALUES ($1, $2, nullif($3, ''), $4, $5::jsonb, nullif($6, ''),
			nullif($7, '')::jsonb, $8, nullif($9, ''), now())
	`, input.TaskType, input.Provider, input.Model, input.PromptVersion,
		string(input.Input), input.RawOutput, parsed, input.Status, input.ErrorMessage)
	return err
}

func scanAssignment(row pgx.Row) (Assignment, error) {
	var assignment Assignment
	err := row.Scan(
		&assignment.ID,
		&assignment.UserID,
		&assignment.Title,
		&assignment.Status,
		&assignment.CreatedAt,
		&assignment.UpdatedAt,
	)
	return assignment, mapNoRows(err)
}

func scanAssignmentImage(row pgx.Row) (AssignmentImage, error) {
	var image AssignmentImage
	err := row.Scan(
		&image.ID,
		&image.AssignmentID,
		&image.OriginalFilename,
		&image.StoredPath,
		&image.MimeType,
		&image.SizeBytes,
		&image.CreatedAt,
	)
	return image, mapNoRows(err)
}

func scanExtractionRun(row pgx.Row) (ExtractionRun, error) {
	var run ExtractionRun
	var parsedContent string
	var stepResults string
	var warnings string
	err := row.Scan(
		&run.ID,
		&run.AssignmentID,
		&run.Status,
		&run.CurrentStep,
		&run.Provider,
		&run.Model,
		&run.PromptVersion,
		&run.RawResponse,
		&parsedContent,
		&stepResults,
		&warnings,
		&run.ErrorMessage,
		&run.CreatedAt,
		&run.StartedAt,
		&run.FinishedAt,
	)
	if err != nil {
		return ExtractionRun{}, mapNoRows(err)
	}
	run.ParsedContent = json.RawMessage(parsedContent)
	run.StepResults = json.RawMessage(stepResults)
	run.Warnings = json.RawMessage(warnings)
	return run, nil
}

func mapNoRows(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

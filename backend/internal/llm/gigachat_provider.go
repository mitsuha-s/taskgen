package llm

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

type GigaChatConfig struct {
	AuthKey   string
	Model     string
	Scope     string
	AuthURL   string
	APIBase   string
	VerifyTLS bool
	Timeout   int64
}

type GigaChatProvider struct {
	authKey string
	model   string
	scope   string
	authURL string
	apiBase string
	client  *http.Client

	mu          sync.Mutex
	accessToken string
	expiresAt   time.Time
}

func NewGigaChatProvider(cfg GigaChatConfig) *GigaChatProvider {
	model := cfg.Model
	if model == "" {
		model = "GigaChat-Pro"
	}
	scope := cfg.Scope
	if scope == "" {
		scope = "GIGACHAT_API_PERS"
	}
	authURL := cfg.AuthURL
	if authURL == "" {
		authURL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth"
	}
	apiBase := strings.TrimRight(cfg.APIBase, "/")
	if apiBase == "" {
		apiBase = "https://gigachat.devices.sberbank.ru/api/v1"
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	if !cfg.VerifyTLS {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // Configurable for GigaChat installations with untrusted local cert chains.
	}

	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 90
	}

	return &GigaChatProvider{
		authKey: cfg.AuthKey,
		model:   model,
		scope:   scope,
		authURL: authURL,
		apiBase: apiBase,
		client:  &http.Client{Timeout: time.Duration(timeout) * time.Second, Transport: transport},
	}
}

func (p *GigaChatProvider) AnalyzeAssignmentImage(ctx context.Context, req AnalyzeAssignmentImageRequest) (*AnalyzeAssignmentImageResponse, error) {
	if strings.TrimSpace(p.authKey) == "" {
		return &AnalyzeAssignmentImageResponse{
			Provider: "gigachat",
			Model:    p.model,
		}, ErrProviderNotConfigured
	}
	if req.MimeType == "image/webp" {
		return &AnalyzeAssignmentImageResponse{
			Provider: "gigachat",
			Model:    p.model,
		}, errors.New("GigaChat image upload supports jpeg/png/tiff/bmp; webp is not supported")
	}

	token, err := p.token(ctx)
	if err != nil {
		return &AnalyzeAssignmentImageResponse{
			Provider: "gigachat",
			Model:    p.model,
		}, err
	}

	fileID, uploadRaw, err := p.uploadFile(ctx, token, req.ImagePath, req.MimeType)
	if err != nil {
		return &AnalyzeAssignmentImageResponse{
			RawResponse: uploadRaw,
			Provider:    "gigachat",
			Model:       p.model,
		}, err
	}

	chatRaw, content, err := p.chat(ctx, token, fileID, req.PromptVersion)
	if err != nil {
		return &AnalyzeAssignmentImageResponse{
			RawResponse: chatRaw,
			Provider:    "gigachat",
			Model:       p.model,
		}, err
	}

	parsed, err := parseJSONObject(content)
	if err != nil {
		return &AnalyzeAssignmentImageResponse{
			RawResponse: chatRaw,
			Provider:    "gigachat",
			Model:       p.model,
		}, err
	}

	return &AnalyzeAssignmentImageResponse{
		RawResponse: chatRaw,
		ParsedJSON:  parsed,
		Provider:    "gigachat",
		Model:       p.model,
	}, nil
}

func (p *GigaChatProvider) token(ctx context.Context) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.accessToken != "" && time.Now().Before(p.expiresAt.Add(-1*time.Minute)) {
		return p.accessToken, nil
	}

	form := url.Values{}
	form.Set("scope", p.scope)
	body := strings.NewReader(form.Encode())
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.authURL, body)
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("RqUID", uuidV4())
	httpReq.Header.Set("Authorization", "Basic "+p.authKey)

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("gigachat oauth request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("gigachat oauth failed: status %d: %s", resp.StatusCode, string(respBody))
	}

	var parsed struct {
		AccessToken string `json:"access_token"`
		ExpiresAt   int64  `json:"expires_at"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", fmt.Errorf("gigachat oauth returned invalid JSON: %w", err)
	}
	if parsed.AccessToken == "" {
		return "", errors.New("gigachat oauth returned empty access_token")
	}

	p.accessToken = parsed.AccessToken
	p.expiresAt = parseTokenExpiration(parsed.ExpiresAt)
	return p.accessToken, nil
}

func (p *GigaChatProvider) uploadFile(ctx context.Context, token, imagePath, mimeType string) (string, string, error) {
	file, err := os.Open(imagePath)
	if err != nil {
		return "", "", err
	}
	defer file.Close()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	fileHeader := make(textproto.MIMEHeader)
	fileHeader.Set("Content-Disposition", `form-data; name="file"; filename="assignment-image"`)
	fileHeader.Set("Content-Type", mimeType)
	part, err := writer.CreatePart(fileHeader)
	if err != nil {
		return "", "", err
	}
	if _, err := io.Copy(part, file); err != nil {
		return "", "", err
	}
	if err := writer.WriteField("purpose", "general"); err != nil {
		return "", "", err
	}
	if err := writer.Close(); err != nil {
		return "", "", err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.apiBase+"/files", &body)
	if err != nil {
		return "", "", err
	}
	httpReq.Header.Set("Authorization", "Bearer "+token)
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return "", "", fmt.Errorf("gigachat file upload failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	raw := string(respBody)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", raw, fmt.Errorf("gigachat file upload failed: status %d: %s", resp.StatusCode, raw)
	}

	var parsed struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", raw, fmt.Errorf("gigachat file upload returned invalid JSON: %w", err)
	}
	if parsed.ID == "" {
		return "", raw, errors.New("gigachat file upload returned empty file id")
	}
	return parsed.ID, raw, nil
}

func (p *GigaChatProvider) chat(ctx context.Context, token, fileID, promptVersion string) (string, string, error) {
	payload := map[string]any{
		"model":       p.model,
		"temperature": 0.1,
		"stream":      false,
		"messages": []map[string]any{
			{
				"role":    "system",
				"content": systemPrompt(promptVersion),
			},
			{
				"role":        "user",
				"content":     "Analyze the attached image and return only the assignment JSON object.",
				"attachments": []string{fileID},
			},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return "", "", err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.apiBase+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	httpReq.Header.Set("Authorization", "Bearer "+token)
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return "", "", fmt.Errorf("gigachat completion request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024))
	raw := string(respBody)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return raw, "", fmt.Errorf("gigachat completion failed: status %d: %s", resp.StatusCode, raw)
	}

	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return raw, "", fmt.Errorf("gigachat completion returned invalid JSON: %w", err)
	}
	if len(parsed.Choices) == 0 || strings.TrimSpace(parsed.Choices[0].Message.Content) == "" {
		return raw, "", errors.New("gigachat completion returned empty content")
	}
	return raw, parsed.Choices[0].Message.Content, nil
}

func systemPrompt(promptVersion string) string {
	return `You are an educational document extraction engine.

Your task is to analyze an image of a school English assignment and extract its exact structure.

Return only a valid JSON object. Do not wrap it in Markdown. Do not include explanations.

Important rules:
- Extract only what is visible in the image.
- Do not generate new tasks.
- Do not improve or rewrite the assignment.
- Do not solve the assignment unless the answer is explicitly visible in the image.
- Preserve original wording as much as possible.
- Preserve numbering and order of sections.
- If text is unreadable, use null and add a warning.
- If structure is unclear, use type "unknown" and add a warning.
- If answer key is not visible, use null for answers.
- The assignment subject is English.
- Return JSON according to this schema:
{
  "title": "string|null",
  "subject": "english",
  "detected_language": "en|ru|mixed|unknown",
  "estimated_level": "A1|A2|B1|B2|C1|C2|unknown",
  "sections": [
    {
      "id": "string",
      "type": "instruction|reading_text|multiple_choice|fill_gap|matching|open_question|unknown",
      "title": "string|null",
      "instruction": "string|null",
      "text": "string|null",
      "items": []
    }
  ],
  "warnings": [
    {
      "type": "unreadable_text|unclear_structure|unsupported_task_type|other",
      "message": "string"
    }
  ]
}

prompt_version: ` + promptVersion
}

func parseJSONObject(content string) (map[string]any, error) {
	trimmed := strings.TrimSpace(content)
	trimmed = strings.TrimPrefix(trimmed, "```json")
	trimmed = strings.TrimPrefix(trimmed, "```")
	trimmed = strings.TrimSuffix(trimmed, "```")
	trimmed = strings.TrimSpace(trimmed)

	start := strings.Index(trimmed, "{")
	end := strings.LastIndex(trimmed, "}")
	if start < 0 || end < start {
		return nil, fmt.Errorf("gigachat response does not contain JSON object: %q", content)
	}

	var parsed map[string]any
	if err := json.Unmarshal([]byte(trimmed[start:end+1]), &parsed); err != nil {
		return nil, fmt.Errorf("gigachat response content is not valid assignment JSON: %w", err)
	}
	return parsed, nil
}

func parseTokenExpiration(raw int64) time.Time {
	if raw <= 0 {
		return time.Now().Add(25 * time.Minute)
	}
	if raw > 1_000_000_000_000 {
		return time.UnixMilli(raw)
	}
	return time.Unix(raw, 0)
}

func uuidV4() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	hexValue := hex.EncodeToString(bytes[:])
	return hexValue[0:8] + "-" + hexValue[8:12] + "-" + hexValue[12:16] + "-" + hexValue[16:20] + "-" + hexValue[20:32]
}

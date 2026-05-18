package files

import (
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
)

var (
	ErrInvalidFileType = errors.New("invalid file type")
	ErrFileTooLarge    = errors.New("file too large")
)

type LocalStorage struct {
	root string
}

type SavedImage struct {
	RelativePath string
	MimeType     string
	SizeBytes    int64
}

func NewLocalStorage(root string) *LocalStorage {
	return &LocalStorage{root: root}
}

func (s *LocalStorage) SaveAssignmentImage(assignmentID string, header *multipart.FileHeader, maxBytes int64) (SavedImage, error) {
	if header.Size > maxBytes {
		return SavedImage{}, ErrFileTooLarge
	}

	mimeType, ext, err := detectUpload(header)
	if err != nil {
		return SavedImage{}, err
	}

	relativePath := filepath.Join("assignments", assignmentID, "original"+ext)
	fullPath := s.FullPath(relativePath)
	if err := os.MkdirAll(filepath.Dir(fullPath), 0o755); err != nil {
		return SavedImage{}, err
	}

	src, err := header.Open()
	if err != nil {
		return SavedImage{}, err
	}
	defer src.Close()

	tempPath := fullPath + ".tmp"
	dst, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return SavedImage{}, err
	}

	written, copyErr := io.Copy(dst, io.LimitReader(src, maxBytes+1))
	closeErr := dst.Close()
	if copyErr != nil {
		_ = os.Remove(tempPath)
		return SavedImage{}, copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tempPath)
		return SavedImage{}, closeErr
	}
	if written > maxBytes {
		_ = os.Remove(tempPath)
		return SavedImage{}, ErrFileTooLarge
	}
	if err := os.Rename(tempPath, fullPath); err != nil {
		_ = os.Remove(tempPath)
		return SavedImage{}, err
	}

	return SavedImage{
		RelativePath: filepath.ToSlash(relativePath),
		MimeType:     mimeType,
		SizeBytes:    written,
	}, nil
}

func (s *LocalStorage) FullPath(relativePath string) string {
	return filepath.Join(s.root, filepath.Clean(relativePath))
}

func detectUpload(header *multipart.FileHeader) (string, string, error) {
	src, err := header.Open()
	if err != nil {
		return "", "", err
	}
	defer src.Close()

	head := make([]byte, 512)
	n, err := io.ReadFull(src, head)
	if err != nil && err != io.ErrUnexpectedEOF && err != io.EOF {
		return "", "", err
	}

	mimeType := http.DetectContentType(head[:n])
	switch mimeType {
	case "image/jpeg":
		return mimeType, ".jpg", nil
	case "image/png":
		return mimeType, ".png", nil
	case "image/webp":
		return mimeType, ".webp", nil
	default:
		return "", "", ErrInvalidFileType
	}
}

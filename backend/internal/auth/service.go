package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"sync"
	"time"
)

const CookieName = "ta_session"

var ErrInvalidCredentials = errors.New("invalid credentials")

type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

type Service struct {
	email        string
	password     string
	cookieSecure bool
	sessions     *SessionStore
}

type SessionStore struct {
	mu       sync.RWMutex
	sessions map[string]time.Time
	ttl      time.Duration
}

func NewService(email, password string, cookieSecure bool) *Service {
	return &Service{
		email:        email,
		password:     password,
		cookieSecure: cookieSecure,
		sessions: &SessionStore{
			sessions: make(map[string]time.Time),
			ttl:      7 * 24 * time.Hour,
		},
	}
}

func (s *Service) Login(w http.ResponseWriter, email, password string) (User, error) {
	if !constantTimeEqual(email, s.email) || !constantTimeEqual(password, s.password) {
		return User{}, ErrInvalidCredentials
	}

	sessionID, err := randomToken()
	if err != nil {
		return User{}, err
	}
	s.sessions.Put(sessionID)
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.cookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(s.sessions.ttl.Seconds()),
	})
	return s.SystemUser(), nil
}

func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(CookieName); err == nil {
		s.sessions.Delete(cookie.Value)
	}
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   s.cookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

func (s *Service) IsAuthenticated(r *http.Request) bool {
	cookie, err := r.Cookie(CookieName)
	if err != nil {
		return false
	}
	return s.sessions.Valid(cookie.Value)
}

func (s *Service) SystemUser() User {
	return User{ID: "default-user", Email: s.email}
}

func (s *SessionStore) Put(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[sessionID] = time.Now().Add(s.ttl)
}

func (s *SessionStore) Valid(sessionID string) bool {
	s.mu.RLock()
	expiresAt, ok := s.sessions[sessionID]
	s.mu.RUnlock()
	if !ok {
		return false
	}
	if time.Now().After(expiresAt) {
		s.Delete(sessionID)
		return false
	}
	return true
}

func (s *SessionStore) Delete(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, sessionID)
}

func randomToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

func constantTimeEqual(left, right string) bool {
	if len(left) != len(right) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

FROM node:24-alpine AS frontend-builder
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM golang:1.25-alpine AS backend-builder
WORKDIR /src/backend
RUN apk add --no-cache ca-certificates
COPY backend/go.mod backend/go.sum* ./
RUN go mod download
COPY backend ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/api ./cmd/api

FROM alpine:3.22
WORKDIR /app
RUN adduser -D -H app \
    && mkdir -p /app/storage/uploads /app/frontend/dist /app/migrations \
    && chown -R app:app /app/storage
COPY --from=backend-builder /out/api /app/api
COPY --from=backend-builder /src/backend/migrations /app/migrations
COPY --from=frontend-builder /src/frontend/dist /app/frontend/dist
ENV HTTP_ADDR=:8080 \
    FRONTEND_DIST_DIR=/app/frontend/dist \
    MIGRATIONS_DIR=/app/migrations \
    FILE_STORAGE_DIR=/app/storage/uploads
EXPOSE 8080
VOLUME ["/app/storage/uploads"]
USER app
CMD ["/app/api"]

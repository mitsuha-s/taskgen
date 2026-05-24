.PHONY: dev down logs frontend-install frontend-lint frontend-build backend-install backend-check check compose-config

dev:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f

frontend-install:
	npm --prefix variantor-fe ci

frontend-lint:
	npm --prefix variantor-fe run lint

frontend-build:
	npm --prefix variantor-fe run build

backend-install:
	python3 -m venv variantor-be/.venv
	variantor-be/.venv/bin/pip install -r variantor-be/requirements.txt

backend-check:
	cd variantor-be && python3 -m compileall app wsgi.py

check: backend-check frontend-lint frontend-build

compose-config:
	docker compose config

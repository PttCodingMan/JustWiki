.PHONY: dev dev-backend dev-frontend build backup clean test test-backend test-frontend lint

dev:
	@echo "Starting backend and frontend..."
	@make dev-backend &
	@make dev-frontend

dev-backend:
	cd backend && source .venv/bin/activate && PYTHON_GIL=1 uvicorn app.main:app --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

backup:
	@mkdir -p backup
	@set -e; \
	if [ ! -f data/just-wiki.db ]; then \
		echo "Error: data/just-wiki.db not found"; exit 1; \
	fi; \
	TS=$$(date +%Y%m%d_%H%M%S); \
	STAGE=backup/.stage-$$TS; \
	mkdir -p $$STAGE; \
	sqlite3 data/just-wiki.db ".backup $$STAGE/just-wiki.db"; \
	if [ -d data/media ]; then cp -R data/media $$STAGE/media; else mkdir $$STAGE/media; fi; \
	tar czf backup/just-wiki-$$TS.tar.gz -C $$STAGE .; \
	rm -rf $$STAGE; \
	echo "Backup complete: backup/just-wiki-$$TS.tar.gz"

clean:
	rm -f data/just-wiki.db
	rm -rf data/media/*
	rm -rf frontend/dist
	@echo "Cleaned"

test: test-backend test-frontend

test-backend:
	cd backend && source .venv/bin/activate && python -m pytest

test-frontend:
	cd frontend && npm test

lint:
	cd frontend && npm run lint

docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

setup:
	@echo "Setting up backend..."
	cd backend && uv venv && source .venv/bin/activate && uv pip install -r requirements.txt -r requirements-dev.txt
	@echo "Setting up frontend..."
	cd frontend && npm install && npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/dom
	@echo "Creating .env..."
	cp -n .env.example .env || true
	@echo "Done! Run 'make dev' to start."

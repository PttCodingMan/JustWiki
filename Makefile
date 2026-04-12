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
	cp data/just-wiki.db backup/just-wiki-$$(date +%Y%m%d_%H%M%S).db
	@echo "Backup complete"

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

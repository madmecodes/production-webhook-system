.PHONY: help setup down test-old test-new test-crash compare clean logs

help:
	@echo "Dodo Webhook Demo - Available Commands"
	@echo "========================================"
	@echo "make setup        - Build and start all services"
	@echo "make down         - Stop all services"
	@echo "make test-old     - Run load test on old architecture"
	@echo "make test-new     - Run load test on new architecture"
	@echo "make test-crash   - Run crash simulation test"
	@echo "make compare      - Show comparison of old vs new"
	@echo "make logs         - Tail logs from all services"
	@echo "make clean        - Remove all containers and volumes"
	@echo ""
	@echo "Full Demo Flow:"
	@echo "  make setup && make test-old && make test-new && make compare"

setup:
	@echo "Building and starting all services..."
	docker-compose build --parallel
	docker-compose up -d
	@echo "Waiting for services to be healthy..."
	sleep 10
	@echo "Services started! Check logs with: make logs"

down:
	@echo "Stopping all services..."
	docker-compose down

clean:
	@echo "Removing containers and volumes..."
	docker-compose down -v
	rm -f results/*.html results/*.json

test-old:
	@echo "Running load test on OLD ARCHITECTURE..."
	@echo "This should show ~0.3% webhook loss (demonstrating the problem)"
	docker-compose run --rm k6 run /scripts/test-old.js --out html=/results/old-report.html --out json=/results/old-metrics.json

test-new:
	@echo "Running load test on NEW ARCHITECTURE..."
	@echo "This should show 99.99%+ reliability (demonstrating the solution)"
	docker-compose run --rm k6 run /scripts/test-new.js --out html=/results/new-report.html --out json=/results/new-metrics.json

test-crash:
	@echo "Running crash simulation test..."
	@echo "Killing pods during load test to demonstrate durability"
	docker-compose run --rm k6 run /scripts/crash-test.js --out html=/results/crash-report.html

compare:
	@echo "Comparing results from old vs new architecture"
	@echo ""
	@echo "Old Architecture Report: file://$(PWD)/results/old-report.html"
	@echo "New Architecture Report: file://$(PWD)/results/new-report.html"
	@echo ""
	@echo "Key metrics to compare:"
	@echo "  - Success rate (old should be ~99.7%, new should be ~99.99%+)"
	@echo "  - Webhook delivery rate"
	@echo "  - Latency distribution (P50, P90, P99)"
	@echo "  - Error count and types"

logs:
	docker-compose logs -f

logs-old-api:
	docker-compose logs -f old-api

logs-new-api:
	docker-compose logs -f new-api

logs-postgres:
	docker-compose logs -f postgres

logs-kafka:
	docker-compose logs -f kafka

logs-restate:
	docker-compose logs -f restate

health-check:
	@echo "Checking service health..."
	@docker-compose ps

shell-db:
	docker-compose exec postgres psql -U dodo -d dodo_demo

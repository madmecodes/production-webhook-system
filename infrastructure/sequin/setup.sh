#!/bin/bash
# Sequin CDC Setup Script for Dodo Webhook Demo

set -e

SEQUIN_URL="http://localhost:7376"

echo "Waiting for Sequin to be ready..."
until curl -s "$SEQUIN_URL/" > /dev/null 2>&1; do
  echo "Waiting for Sequin..."
  sleep 2
done
echo "Sequin is ready!"

# Create database connection
echo "Creating database connection..."
curl -X POST "$SEQUIN_URL/api/databases" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "dodo_demo_db",
    "host": "postgres",
    "port": 5432,
    "database": "dodo_demo",
    "username": "dodo",
    "password": "dodo_pass",
    "ssl": false,
    "pool_size": 5
  }' || echo "Database connection may already exist"

# Create replication slot and publication
echo "Creating replication slot..."
curl -X POST "$SEQUIN_URL/api/replication_slots" \
  -H "Content-Type: application/json" \
  -d '{
    "database_id": "dodo_demo_db",
    "slot_name": "domain_events_slot",
    "publication_name": "domain_events_pub"
  }' || echo "Replication slot may already exist"

# Create Kafka sink
echo "Creating Kafka sink..."
curl -X POST "$SEQUIN_URL/api/sinks" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "kafka",
    "name": "webhook_events_sink",
    "database_id": "dodo_demo_db",
    "slot_name": "domain_events_slot",
    "kafka_brokers": ["kafka:9092"],
    "kafka_topic": "webhook-events",
    "table_schema": "public",
    "table_name": "domain_events",
    "message_format": "json"
  }' || echo "Kafka sink may already exist"

echo "Sequin setup complete!"
echo "Check status at: $SEQUIN_URL"

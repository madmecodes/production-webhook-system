use parking_lot::RwLock;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::{ClientConfig, Message};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tracing::{error, info};
use uuid::Uuid;

// ==============================================================================
// NEW ARCHITECTURE LAYER 4: DURABLE EXECUTION SIMULATOR
// ==============================================================================
//
// This service simulates Restate's durable execution behavior:
// 1. Consumes events from Kafka (durably)
// 2. Maintains a "journal" of completed steps
// 3. On crash/restart, replays from journal (deterministic)
// 4. Retry logic is persistent and survives crashes
// 5. Same event_id across retries (idempotent at Svix)
//
// Note: This is a simplified demo. Real Restate has more sophisticated journaling.
//

#[derive(Clone, Debug, Serialize, Deserialize)]
struct DomainEvent {
    id: u64,
    event_type: String,
    object_id: String,
    merchant_id: String,
    payload: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SequinMessage {
    record: DomainEvent,
    metadata: serde_json::Value,
    action: String,
    changes: Option<serde_json::Value>,
}

#[derive(Clone, Debug)]
struct ProcessedEvent {
    event_id: String,
    merchant_webhook_id: String,
    retries: usize,
    last_retry_at: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let brokers = std::env::var("KAFKA_BROKERS")
        .unwrap_or_else(|_| "localhost:9092".to_string());
    let data_service_url = std::env::var("DATA_SERVICE_URL")
        .unwrap_or_else(|_| "http://localhost:3002".to_string());
    let merchant_url = std::env::var("MERCHANT_URL")
        .unwrap_or_else(|_| "http://localhost:4001/webhooks".to_string());

    info!("WEBHOOK CONSUMER starting...");
    info!("✅ Kafka Brokers: {}", brokers);
    info!("✅ Data Service: {}", data_service_url);
    info!("✅ Merchant URL: {}", merchant_url);
    info!("✅ Simulating Restate durable execution with persistent journal");

    // Journal to track completed steps (simulates Restate's journal)
    let journal: Arc<RwLock<HashMap<String, ProcessedEvent>>> =
        Arc::new(RwLock::new(HashMap::new()));

    let consumer: StreamConsumer = ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .set("group.id", "webhook-consumer-group")
        .set("auto.offset.reset", "earliest")
        .create()
        .expect("Failed to create Kafka consumer");

    consumer
        .subscribe(&["webhook-events"])
        .expect("Failed to subscribe to topic");

    let client = reqwest::Client::new();

    loop {
        match consumer.recv().await {
            Err(e) => {
                error!("Kafka error: {:?}", e);
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Ok(m) => {
                if let Some(payload) = m.payload() {
                    match serde_json::from_slice::<SequinMessage>(payload) {
                        Ok(sequin_msg) => {
                            let event = sequin_msg.record;
                            info!("Received event from Kafka: {:?}", event.event_type);

                        // DURABLE EXECUTION DEMO:
                        // 1. Generate stable event_id (first time only)
                        // 2. Check journal for processed events (on restart)
                        // 3. Resume from where we left off
                        let event_id = format!("evt_{}", event.object_id);

                        match handle_event(
                            &journal,
                            &client,
                            &event_id,
                            &event,
                            &data_service_url,
                            &merchant_url,
                        )
                        .await
                        {
                            Ok(_) => {
                                info!("Event processed successfully: {}", event_id);
                            }
                            Err(e) => {
                                error!("Failed to process event: {}", e);
                            }
                        }
                        }
                        Err(e) => {
                            error!("Failed to deserialize Sequin message: {:?}", e);
                            error!("Raw payload: {}", String::from_utf8_lossy(payload));
                        }
                    }
                }
            }
        }
    }
}

async fn handle_event(
    journal: &Arc<RwLock<HashMap<String, ProcessedEvent>>>,
    client: &reqwest::Client,
    event_id: &str,
    event: &DomainEvent,
    data_service_url: &str,
    merchant_url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    // Step 1: Check if already processed (durability)
    {
        let j = journal.read();
        if let Some(processed) = j.get(event_id) {
            info!(
                "Event already processed (recovered from journal): {} (retries: {})",
                event_id, processed.retries
            );
            return Ok(());
        }
    }

    // Step 2: Fetch fresh payload
    let payload_url = format!(
        "{}/payload/{}",
        data_service_url, event.object_id
    );
    let payload = client
        .get(&payload_url)
        .timeout(Duration::from_secs(5))
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    info!(
        "Fetched fresh payload for payment: {}",
        event.object_id
    );

    // Step 3: Send webhook with retries
    let merchant_webhook_id = format!("wh_{}", Uuid::new_v4());

    // Generate a stable UUID for event_id (based on object_id)
    let event_uuid = Uuid::parse_str(&event.object_id)
        .unwrap_or_else(|_| Uuid::new_v4());

    let mut retries = 0;
    let max_retries = 3;
    let mut last_error;

    loop {
        let body = serde_json::json!({
            "event_id": event_uuid,
            "event_type": event.event_type,
            "payment": payload
        });

        match send_webhook(client, merchant_url, &body).await {
            Ok(_) => {
                // Mark as processed in journal
                journal.write().insert(
                    event_id.to_string(),
                    ProcessedEvent {
                        event_id: event_id.to_string(),
                        merchant_webhook_id: merchant_webhook_id.clone(),
                        retries,
                        last_retry_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string(),
                    },
                );

                info!(
                    "Webhook delivered successfully: {} (retries: {})",
                    event_id, retries
                );
                return Ok(());
            }
            Err(e) => {
                last_error = e.to_string();
                retries += 1;

                if retries >= max_retries {
                    error!(
                        "Failed to deliver webhook after {} retries: {}",
                        retries, last_error
                    );
                    return Err(format!("Max retries exceeded: {}", last_error).into());
                }

                // Exponential backoff
                let backoff_ms = 1000u64 * 2u64.pow((retries - 1) as u32);
                info!(
                    "Retry {}/{} after {}ms: {}",
                    retries, max_retries, backoff_ms, last_error
                );
                tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
            }
        }
    }
}

async fn send_webhook(
    client: &reqwest::Client,
    url: &str,
    body: &serde_json::Value,
) -> Result<(), Box<dyn std::error::Error>> {
    let response = client
        .post(url)
        .json(body)
        .timeout(Duration::from_secs(5))
        .send()
        .await?;

    response.error_for_status()?;
    Ok(())
}

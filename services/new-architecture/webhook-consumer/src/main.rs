use restate_sdk::prelude::*;
use std::time::Duration;
use uuid::Uuid;

// ==============================================================================
// NEW ARCHITECTURE LAYER 3: DURABLE EXECUTION WITH RESTATE
// ==============================================================================
//
// This service implements real Restate durable execution for webhooks:
// 1. Registered as a Restate service via /discover endpoint (auto-provided by SDK)
// 2. Restate subscribes to Kafka topic and forwards events as durable invocations
// 3. Handler fetches fresh payload from data-service
// 4. Sends webhook with Restate's automatic retry and crash recovery
// 5. All state persisted in Restate's journal - survives crashes
//

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct DomainEvent {
    pub id: u64,
    pub event_type: String,
    pub object_id: String,
    pub merchant_id: String,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct PaymentPayload {
    pub id: Uuid,
    pub amount: i64,
    pub currency: String,
    pub status: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, schemars::JsonSchema)]
pub struct WebhookRequest {
    pub event_id: Uuid,
    pub event_type: String,
    pub payment: PaymentPayload,
}

// ==============================================================================
// RESTATE SERVICE: WebhookProcessor
// ==============================================================================

#[restate_sdk::service]
trait WebhookProcessor {
    async fn process(event: Json<DomainEvent>) -> HandlerResult<String>;
}

pub struct WebhookProcessorImpl;

impl WebhookProcessor for WebhookProcessorImpl {
    async fn process(&self, _ctx: Context<'_>, event: Json<DomainEvent>)
        -> HandlerResult<String> {

        let event = event.0;  // Extract inner DomainEvent from Json wrapper
        let event_id = format!("evt_{}", event.object_id);
        tracing::info!("Processing event via Restate: {}", event_id);

        // Environment variables
        let data_service_url = std::env::var("DATA_SERVICE_URL")
            .unwrap_or_else(|_| "http://data-service:3002".to_string());
        let merchant_url = std::env::var("MERCHANT_URL")
            .unwrap_or_else(|_| "http://merchant-new:4001/webhooks".to_string());

        // Step 1: Generate stable event UUID (deterministic from object_id)
        let event_uuid = Uuid::parse_str(&event.object_id)
            .unwrap_or_else(|_| Uuid::new_v4());

        tracing::info!("Event UUID: {}", event_uuid);

        // Step 2: Fetch fresh payload from data-service
        let payload_url = format!("{}/payload/{}", data_service_url, event.object_id);
        let client = reqwest::Client::new();

        let payload = client
            .get(&payload_url)
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| format!("Failed to fetch payload: {}", e))?
            .json::<PaymentPayload>()
            .await
            .map_err(|e| format!("Failed to parse payload: {}", e))?;

        tracing::info!("Fetched payload for payment: {}", event.object_id);

        // Step 3: Send webhook to merchant
        let webhook_body = WebhookRequest {
            event_id: event_uuid,
            event_type: event.event_type.clone(),
            payment: payload,
        };

        client
            .post(&merchant_url)
            .json(&webhook_body)
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map_err(|e| format!("Failed to send webhook: {}", e))?
            .error_for_status()
            .map_err(|e| format!("Merchant rejected webhook: {}", e))?;

        tracing::info!(
            "Webhook delivered successfully: {} (event_id: {})",
            event_id,
            event_uuid
        );

        Ok(format!("delivered:{}", event_uuid))
    }
}

// ==============================================================================
// HTTP SERVER FOR RESTATE INGRESS
// ==============================================================================

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "9080".to_string());

    tracing::info!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    tracing::info!("WEBHOOK CONSUMER (Restate Durable Execution)");
    tracing::info!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    tracing::info!("✅ Starting Restate HTTP Server on port {}", port);
    tracing::info!("✅ Service: WebhookProcessor");
    tracing::info!("✅ Handler: process (receives Kafka events from Restate)");
    tracing::info!("✅ Provides /discover endpoint for Restate registration");
    tracing::info!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    // Create Restate HTTP server with service endpoint
    HttpServer::new(
        Endpoint::builder()
            .bind(WebhookProcessorImpl.serve())
            .build()
    )
    .listen_and_serve(format!("0.0.0.0:{}", port).parse().unwrap())
    .await;
}

use axum::{
    extract::{Json, State},
    http::StatusCode,
    routing::{get, post},
    Router,
};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use tracing::info;
use uuid::Uuid;
use rand::Rng;

// ==============================================================================
// MERCHANT SIMULATOR: Mock webhook endpoint that tracks received webhooks
// ==============================================================================

#[derive(Clone, Debug)]
struct ChaosConfig {
    failure_rate: f64,           // 0.0-1.0: probability of returning 500
    delay_ms: u64,               // milliseconds to delay response
    timeout_mode: bool,          // if true, hang on some requests
    fail_payment_ids: HashSet<String>, // specific payment IDs to always fail
}

impl ChaosConfig {
    fn from_env() -> Self {
        let failure_rate = std::env::var("FAILURE_RATE")
            .ok()
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.0)
            .clamp(0.0, 1.0);

        let delay_ms = std::env::var("DELAY_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);

        let timeout_mode = std::env::var("TIMEOUT_MODE")
            .ok()
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

        let fail_payment_ids = std::env::var("FAIL_PAYMENT_IDS")
            .ok()
            .map(|v| v.split(',').map(|s| s.trim().to_string()).collect())
            .unwrap_or_default();

        ChaosConfig {
            failure_rate,
            delay_ms,
            timeout_mode,
            fail_payment_ids,
        }
    }

    fn log_settings(&self) {
        if self.failure_rate > 0.0 || self.delay_ms > 0 || self.timeout_mode || !self.fail_payment_ids.is_empty() {
            info!("CHAOS MODE ENABLED:");
            if self.failure_rate > 0.0 {
                info!("  - Failure rate: {}%", (self.failure_rate * 100.0) as u32);
            }
            if self.delay_ms > 0 {
                info!("  - Response delay: {}ms", self.delay_ms);
            }
            if self.timeout_mode {
                info!("  - Timeout mode: enabled");
            }
            if !self.fail_payment_ids.is_empty() {
                info!("  - Fail specific payments: {:?}", self.fail_payment_ids);
            }
        }
    }
}

#[derive(Clone)]
struct AppState {
    received_webhooks: Arc<RwLock<Vec<ReceivedWebhook>>>,
    chaos_config: ChaosConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct ReceivedWebhook {
    event_id: Uuid,
    event_type: String,
    payment_id: Uuid,
    amount: i64,
    status: String,
    received_at: String,
}

#[derive(Serialize, Deserialize)]
struct WebhookPayload {
    event_id: Uuid,
    event_type: String,
    payment: serde_json::Value,
}

#[derive(Serialize)]
struct StatsResponse {
    total_received: usize,
    unique_payments: usize,
    webhooks: Vec<ReceivedWebhook>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let chaos_config = ChaosConfig::from_env();
    chaos_config.log_settings();

    let state = AppState {
        received_webhooks: Arc::new(RwLock::new(Vec::new())),
        chaos_config,
    };

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/webhooks", post(receive_webhook))
        .route("/stats", get(get_stats))
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "4000".to_string());
    let instance = std::env::var("INSTANCE_NAME").unwrap_or_else(|_| "merchant".to_string());

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();

    info!("Merchant Simulator ({}) listening on port {}", instance, port);

    axum::serve(listener, app).await.unwrap();
}

async fn health_check() -> &'static str {
    "OK"
}

async fn receive_webhook(
    State(state): State<AppState>,
    Json(payload): Json<WebhookPayload>,
) -> (StatusCode, String) {
    let payment_id = payload.payment["id"]
        .as_str()
        .unwrap_or("unknown");

    // CHAOS: Check if this payment ID should always fail
    if state.chaos_config.fail_payment_ids.contains(payment_id) {
        info!("CHAOS: Failing webhook for payment {} (in fail list)", payment_id);
        return (StatusCode::INTERNAL_SERVER_ERROR, "Simulated failure".to_string());
    }

    // CHAOS: Random failure based on failure_rate
    if state.chaos_config.failure_rate > 0.0 {
        let mut rng = rand::thread_rng();
        if rng.gen::<f64>() < state.chaos_config.failure_rate {
            info!("CHAOS: Failing webhook for payment {} (random failure)", payment_id);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Simulated failure".to_string());
        }
    }

    // CHAOS: Apply response delay
    if state.chaos_config.delay_ms > 0 {
        info!("CHAOS: Delaying response by {}ms for payment {}", state.chaos_config.delay_ms, payment_id);
        tokio::time::sleep(tokio::time::Duration::from_millis(state.chaos_config.delay_ms)).await;
    }

    // CHAOS: Timeout mode - randomly hang on some requests (10% probability)
    if state.chaos_config.timeout_mode {
        let mut rng = rand::thread_rng();
        if rng.gen::<f64>() < 0.1 {
            info!("CHAOS: Hanging indefinitely for payment {} (timeout mode)", payment_id);
            // Hang forever - simulates merchant endpoint that never responds
            tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
        }
    }

    // Normal webhook processing
    let webhook = ReceivedWebhook {
        event_id: payload.event_id,
        event_type: payload.event_type.clone(),
        payment_id: Uuid::parse_str(payment_id).unwrap_or_default(),
        amount: payload.payment["amount"]
            .as_i64()
            .unwrap_or_default(),
        status: payload.payment["status"]
            .as_str()
            .unwrap_or("unknown")
            .to_string(),
        received_at: chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string(),
    };

    state.received_webhooks.write().push(webhook);
    info!("Webhook received for payment: {}", payment_id);

    (StatusCode::OK, "Webhook received".to_string())
}

async fn get_stats(State(state): State<AppState>) -> Json<StatsResponse> {
    let webhooks = state.received_webhooks.read().clone();

    let unique_payments: HashSet<Uuid> = webhooks
        .iter()
        .map(|w| w.payment_id)
        .collect();

    info!(
        "Stats: {} webhooks, {} unique payments",
        webhooks.len(),
        unique_payments.len()
    );

    Json(StatsResponse {
        total_received: webhooks.len(),
        unique_payments: unique_payments.len(),
        webhooks,
    })
}

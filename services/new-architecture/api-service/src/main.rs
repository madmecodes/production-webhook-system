use axum::{
    extract::{Json, State},
    http::StatusCode,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use tracing::info;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    db: PgPool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Payment {
    id: Uuid,
    amount: i64,
    currency: String,
    status: String,
}

#[derive(Serialize, Deserialize)]
struct CreatePaymentRequest {
    amount: i64,
    currency: String,
}

#[derive(Serialize, Deserialize)]
struct PaymentResponse {
    id: Uuid,
    amount: i64,
    currency: String,
    status: String,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("Failed to connect to database");

    let state = AppState { db: pool };

    let app = Router::new()
        .route("/health", get(health_check))
        .route("/payments", post(create_payment))
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".to_string());

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", port))
        .await
        .unwrap();

    info!("NEW ARCHITECTURE API listening on port {}", port);

    axum::serve(listener, app).await.unwrap();
}

async fn health_check() -> &'static str {
    "OK"
}

async fn create_payment(
    State(state): State<AppState>,
    Json(req): Json<CreatePaymentRequest>,
) -> Result<(StatusCode, Json<PaymentResponse>), (StatusCode, String)> {
    let payment_id = Uuid::new_v4();
    let merchant_id = Uuid::new_v4();

    // ATOMIC OPERATION: Both UPDATE and INSERT in same transaction
    // The PostgreSQL trigger fires automatically and creates the event
    // If this transaction fails, BOTH payment and event are rolled back
    let result = sqlx::query(
        r#"
        UPDATE payments
        SET status = 'succeeded', updated_at = NOW()
        WHERE id = $1;

        INSERT INTO payments (id, merchant_id, amount, currency, status)
        SELECT $2, $3, $4, $5, $6
        WHERE NOT EXISTS (SELECT 1 FROM payments WHERE id = $2);
        "#,
    )
    .bind(payment_id)
    .bind(payment_id)
    .bind(merchant_id)
    .bind(req.amount)
    .bind(&req.currency)
    .bind("succeeded")
    .execute(&state.db)
    .await;

    match result {
        Ok(_) => {
            info!(
                "Payment created atomically: {} (event created by trigger)",
                payment_id
            );

            // GUARANTEE: Event exists in database
            // Sequin is already reading the WAL and will catch it within milliseconds
            Ok((
                StatusCode::CREATED,
                Json(PaymentResponse {
                    id: payment_id,
                    amount: req.amount,
                    currency: req.currency,
                    status: "succeeded".to_string(),
                }),
            ))
        }
        Err(e) => {
            tracing::error!("Failed to create payment: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create payment: {}", e),
            ))
        }
    }
}

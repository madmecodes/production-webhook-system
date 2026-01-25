FROM rust:latest as builder

WORKDIR /app
COPY Cargo.toml Cargo.toml
COPY src src

RUN apt-get update && apt-get install -y librdkafka-dev cmake build-essential && rm -rf /var/lib/apt/lists/*
RUN cargo build --release

FROM debian:trixie-slim

RUN apt-get update && apt-get install -y ca-certificates librdkafka1 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/webhook-consumer /app/webhook-consumer

CMD ["/app/webhook-consumer"]

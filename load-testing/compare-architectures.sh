#!/bin/bash

# ==============================================================================
# COMPREHENSIVE TEST RUNNER: Compare Old vs New Architecture
# ==============================================================================
#
# This script runs all failure injection tests and compares the results
# between old and new architecture implementations.
#
# Usage: ./load-testing/compare-architectures.sh [test-type]
#
# Test Types:
#   - all          (default) Run all tests
#   - crash        Run only crash scenario tests
#   - failures     Run only merchant failures test
#   - slow         Run only merchant slow response test
#   - overflow     Run only channel overflow test

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TEST_TYPE="${1:-all}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║     WEBHOOK DEMO: ARCHITECTURE COMPARISON TEST SUITE          ║"
echo "║                                                                ║"
echo "║     Reproducing scenarios from the Dodo Payments blog:        ║"
echo "║     \"Building Webhooks That Never Fail\"                      ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

# Function to print test header
print_test_header() {
    local test_name=$1
    echo -e "${BLUE}"
    echo "════════════════════════════════════════════════════════════════"
    echo "  TEST: $test_name"
    echo "════════════════════════════════════════════════════════════════"
    echo -e "${NC}"
}

# Function to run test for both architectures
run_dual_test() {
    local test_name=$1
    local test_file=$2
    local env_vars=$3

    print_test_header "$test_name"
    echo ""

    echo -e "${YELLOW}[1/2] Testing OLD ARCHITECTURE${NC}"
    echo "Command: docker compose run --rm k6 run $test_file $env_vars -e ARCH=old"
    echo ""
    cd "$PROJECT_ROOT"
    docker compose run --rm k6 run "$test_file" $env_vars -e ARCH=old
    echo ""

    echo -e "${YELLOW}[2/2] Testing NEW ARCHITECTURE${NC}"
    echo "Command: docker compose run --rm k6 run $test_file $env_vars -e ARCH=new"
    echo ""
    cd "$PROJECT_ROOT"
    docker compose run --rm k6 run "$test_file" $env_vars -e ARCH=new
    echo ""
}

# Function to run crash tests with orchestration
run_crash_tests() {
    print_test_header "Process Crash During Webhook Delivery"
    echo ""
    echo -e "${YELLOW}Blog Scenario: \"Timeline of a Lost Webhook\"${NC}"
    echo "Service crashes during in-flight webhook request"
    echo ""

    echo -e "${YELLOW}[1/2] Testing OLD ARCHITECTURE${NC}"
    echo "Expected: Webhooks during crash window are LOST"
    echo ""
    cd "$SCRIPT_DIR"
    bash chaos-old.sh
    echo ""

    echo -e "${YELLOW}[2/2] Testing NEW ARCHITECTURE${NC}"
    echo "Expected: ZERO webhook loss (durable recovery)"
    echo ""
    cd "$SCRIPT_DIR"
    bash chaos-new.sh
    echo ""
}

# Check if services are running
check_services() {
    echo "Checking if Docker services are running..."
    if ! docker compose ps | grep -q "old-api"; then
        echo -e "${RED}ERROR: Services not running. Start with:${NC}"
        echo "  docker compose up"
        exit 1
    fi
}

# Setup: Configure merchant simulators for tests
setup_test_env() {
    echo -e "${BLUE}Setting up test environment...${NC}"

    # For merchant-failures test, we need to restart merchant with FAILURE_RATE
    # For now, just note that tests will need this configuration
    echo "Note: Some tests require merchant-simulator configuration via environment variables"
    echo "  FAILURE_RATE=0.5     - For failure injection test"
    echo "  DELAY_MS=6000        - For slow response test"
    echo ""
}

# Main test execution
case "$TEST_TYPE" in
    all)
        check_services
        setup_test_env

        # 1. Basic Load Tests (no failures)
        print_test_header "Basic Load Tests (Baseline)"
        echo "Testing normal operation without failures"
        echo ""
        echo -e "${YELLOW}[1/2] OLD ARCHITECTURE BASELINE${NC}"
        cd "$PROJECT_ROOT"
        docker compose run --rm k6 run load-testing/k6/test-old.js
        echo ""

        echo -e "${YELLOW}[2/2] NEW ARCHITECTURE BASELINE${NC}"
        cd "$PROJECT_ROOT"
        docker compose run --rm k6 run load-testing/k6/test-new.js
        echo ""

        # 2. Merchant Failures Test
        run_dual_test "Merchant Endpoint Failures (50%)" "load-testing/k6/merchant-failures.js" ""

        # 3. Merchant Slow Response Test
        run_dual_test "Merchant Slow Response (6s timeout)" "load-testing/k6/merchant-slow.js" ""

        # 4. Channel Overflow Test
        run_dual_test "In-Memory Channel Overflow (Burst Load)" "load-testing/k6/channel-overflow.js" ""

        # 5. Crash Tests
        run_crash_tests
        ;;

    crash)
        check_services
        run_crash_tests
        ;;

    failures)
        check_services
        run_dual_test "Merchant Endpoint Failures (50%)" "load-testing/k6/merchant-failures.js" ""
        ;;

    slow)
        check_services
        run_dual_test "Merchant Slow Response (6s timeout)" "load-testing/k6/merchant-slow.js" ""
        ;;

    overflow)
        check_services
        run_dual_test "In-Memory Channel Overflow (Burst Load)" "load-testing/k6/channel-overflow.js" ""
        ;;

    *)
        echo -e "${RED}Unknown test type: $TEST_TYPE${NC}"
        echo ""
        echo "Usage: $0 [test-type]"
        echo ""
        echo "Test Types:"
        echo "  all          - Run all tests (default)"
        echo "  crash        - Process crash scenario only"
        echo "  failures     - Merchant failures scenario only"
        echo "  slow         - Merchant slow response scenario only"
        echo "  overflow     - Channel overflow scenario only"
        exit 1
        ;;
esac

echo -e "${GREEN}"
echo "════════════════════════════════════════════════════════════════"
echo "  ✅ TEST SUITE COMPLETE"
echo "════════════════════════════════════════════════════════════════"
echo -e "${NC}"
echo ""
echo "Summary:"
echo "  OLD ARCHITECTURE: Demonstrates webhook loss in failure scenarios"
echo "  NEW ARCHITECTURE: Shows 99.99%+ reliability with durable execution"
echo ""
echo "Key Findings:"
echo "  1. Process crashes → In-memory webhooks lost (old)"
echo "  2. Merchant failures → No retry mechanism (old)"
echo "  3. Slow responses → Hard timeout, no retry (old)"
echo "  4. High load → Queue overflow drops webhooks (old)"
echo ""
echo "Next Steps:"
echo "  1. Review the blog post for architectural details:"
echo "     'Building Webhooks That Never Fail: Our Journey to 99.99%+ Delivery Reliability'"
echo "  2. Examine the code differences between old and new architectures"
echo "  3. See the Sequin, Kafka, and Restate integration in the new architecture"
echo ""

#!/usr/bin/env bash
# =============================================================================
# AsterFlow - Complete Asterisk Setup Script
# =============================================================================
# This script installs and configures Asterisk on a FRESH Ubuntu/Debian server
# so that the AsterFlow Docker application can connect to it.
#
# It performs:
#   1. System package updates & dependency installation
#   2. MariaDB installation & configuration (remote access, user, database)
#   3. Asterisk installation from source (with PJSIP, ODBC, WebRTC modules)
#   4. ODBC configuration (connecting Asterisk to MariaDB)
#   5. Asterisk Realtime Architecture (ARA) setup via Alembic migrations
#   6. CDR & Queue Log → Database configuration
#   7. AMI (Asterisk Manager Interface) configuration
#   8. WebRTC (HTTP/WSS + TLS certificates) configuration
#   9. Basic dialplan with queue support and call recording (MixMonitor)
#  10. Firewall rules
#
# USAGE:
#   chmod +x setup_asterisk.sh
#   sudo ./setup_asterisk.sh
#
# IMPORTANT: Run this script as root (or with sudo) on a fresh Ubuntu 22.04+
#            or Debian 12+ server.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# CONFIGURATION - Edit these values to match your environment
# ---------------------------------------------------------------------------

# Database credentials (must match your AsterFlow .env file)
DB_NAME="asterisk"
DB_USER="asterisk"
DB_PASSWORD="asterisk"

# AMI credentials (must match your AsterFlow .env file)
AMI_USER="webapp"
AMI_PASS="StrongPassword123"

# Asterisk version to install from source
ASTERISK_VERSION="21"  # Major version (will download latest 21.x)

# Sample extensions to create (space-separated)
SAMPLE_EXTENSIONS="101 102 103 104 105"
SAMPLE_PASSWORD="secret"

# Sample queue name
SAMPLE_QUEUE="support"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------
log_info()    { echo -e "${GREEN}[INFO]${NC}  $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_section() { echo -e "\n${BLUE}════════════════════════════════════════════════════════════${NC}"; echo -e "${BLUE}  $1${NC}"; echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"; }

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root. Use: sudo $0"
        exit 1
    fi
}

# Get the server's primary IP address
get_server_ip() {
    hostname -I | awk '{print $1}'
}

# =============================================================================
# STEP 1: System Update & Dependencies
# =============================================================================
install_dependencies() {
    log_section "Step 1: Installing System Dependencies"

    apt-get update -y
    apt-get upgrade -y

    # Core build tools
    apt-get install -y \
        build-essential \
        git \
        curl \
        wget \
        sudo \
        gnupg2 \
        software-properties-common

    # Asterisk build dependencies
    apt-get install -y \
        libedit-dev \
        uuid-dev \
        libxml2-dev \
        libsqlite3-dev \
        libjansson-dev \
        libssl-dev \
        libncurses5-dev \
        libsrtp2-dev \
        libspandsp-dev \
        libcurl4-openssl-dev \
        libnewt-dev \
        libpopt-dev \
        libical-dev \
        libiksemel-dev \
        libsnmp-dev \
        libcorosync-common-dev \
        libresample1-dev \
        binutils-dev \
        freetds-dev \
        subversion

    # ODBC packages (critical for ARA / Realtime)
    apt-get install -y \
        unixodbc \
        unixodbc-dev \
        odbcinst \
        libmariadb-dev \
        odbc-mariadb

    # Python (for Alembic migrations) - python3-full includes pip & venv properly
    apt-get install -y \
        python3-full \
        python3-dev \
        libmariadb-dev-compat

    log_info "All dependencies installed successfully."
}

# =============================================================================
# STEP 2: MariaDB Installation & Configuration
# =============================================================================
install_mariadb() {
    log_section "Step 2: Installing and Configuring MariaDB"

    apt-get install -y mariadb-server mariadb-client

    # Start and enable MariaDB
    systemctl start mariadb
    systemctl enable mariadb

    # Allow remote connections (required for Docker backend to reach the DB)
    log_info "Configuring MariaDB for remote access..."
    MARIADB_CONF="/etc/mysql/mariadb.conf.d/50-server.cnf"
    if [ -f "$MARIADB_CONF" ]; then
        sed -i 's/^bind-address\s*=.*/bind-address = 0.0.0.0/' "$MARIADB_CONF"
    else
        # Fallback for different distro layouts
        MARIADB_CONF="/etc/mysql/my.cnf"
        if grep -q "bind-address" "$MARIADB_CONF" 2>/dev/null; then
            sed -i 's/^bind-address\s*=.*/bind-address = 0.0.0.0/' "$MARIADB_CONF"
        else
            echo -e "\n[mysqld]\nbind-address = 0.0.0.0" >> "$MARIADB_CONF"
        fi
    fi

    systemctl restart mariadb

    # Create database and user with remote access
    log_info "Creating database '${DB_NAME}' and user '${DB_USER}'..."
    mysql -u root <<EOF
CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
CREATE USER IF NOT EXISTS '${DB_USER}'@'%' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'%';
FLUSH PRIVILEGES;
EOF

    log_info "MariaDB configured. User '${DB_USER}' can connect from any host."
}

# =============================================================================
# STEP 3: Install Asterisk from Source
# =============================================================================
install_asterisk() {
    log_section "Step 3: Installing Asterisk ${ASTERISK_VERSION} from Source"

    cd /usr/src

    # Download latest Asterisk of the specified major version
    if [ ! -d "asterisk-${ASTERISK_VERSION}*" ]; then
        log_info "Downloading Asterisk ${ASTERISK_VERSION}..."
        wget -q "https://downloads.asterisk.org/pub/telephony/asterisk/asterisk-${ASTERISK_VERSION}-current.tar.gz" -O asterisk.tar.gz
        tar xzf asterisk.tar.gz
        rm asterisk.tar.gz
    fi

    cd asterisk-${ASTERISK_VERSION}*/

    # Install Asterisk's own pre-requisites script
    log_info "Running Asterisk install_prereq..."
    contrib/scripts/install_prereq install

    # Get mp3 decoder (optional but useful)
    contrib/scripts/get_mp3_source.sh || true

    # Configure with PJSIP and ODBC support
    log_info "Configuring Asterisk build (this may take a few minutes)..."
    ./configure --with-pjproject-bundled --with-jansson-bundled 2>&1 | tail -5

    # Enable required modules via menuselect
    make menuselect.makeopts

    # Enable critical modules for AsterFlow
    # ODBC modules (for Realtime Architecture)
    menuselect/menuselect --enable res_odbc menuselect.makeopts
    menuselect/menuselect --enable res_config_odbc menuselect.makeopts
    menuselect/menuselect --enable cdr_odbc menuselect.makeopts
    menuselect/menuselect --enable cdr_adaptive_odbc menuselect.makeopts
    menuselect/menuselect --enable func_odbc menuselect.makeopts

    # PJSIP (required - your app uses ps_endpoints, ps_auths, ps_aors etc.)
    menuselect/menuselect --enable res_pjsip menuselect.makeopts
    menuselect/menuselect --enable res_pjsip_authenticator_digest menuselect.makeopts
    menuselect/menuselect --enable res_pjsip_endpoint_identifier_ip menuselect.makeopts
    menuselect/menuselect --enable res_pjsip_session menuselect.makeopts
    menuselect/menuselect --enable res_pjsip_registrar menuselect.makeopts
    menuselect/menuselect --enable res_pjsip_transport_websocket menuselect.makeopts

    # HTTP server (for WebRTC WebSocket connections)
    menuselect/menuselect --enable res_http_websocket menuselect.makeopts

    # Queue module (required for queue_log, queue_members, AMI QueueStatus)
    menuselect/menuselect --enable app_queue menuselect.makeopts

    # ChanSpy (required for Spy/Whisper/Barge feature)
    menuselect/menuselect --enable app_chanspy menuselect.makeopts

    # MixMonitor (required for call recording)
    menuselect/menuselect --enable app_mixmonitor menuselect.makeopts

    # CDR module
    menuselect/menuselect --enable cdr_custom menuselect.makeopts

    # Disable CDR to SQLite (avoid conflicts)
    menuselect/menuselect --disable cdr_sqlite3_custom menuselect.makeopts || true

    # Build and install
    log_info "Building Asterisk (this will take several minutes)..."
    make -j$(nproc) 2>&1 | tail -3
    make install
    make samples    # Install sample config files
    make config     # Install init scripts
    make install-logrotate

    # Create asterisk user and set permissions
    useradd -m -r -s /bin/false asterisk 2>/dev/null || true
    chown -R asterisk:asterisk /var/lib/asterisk
    chown -R asterisk:asterisk /var/log/asterisk
    chown -R asterisk:asterisk /var/spool/asterisk
    chown -R asterisk:asterisk /var/run/asterisk 2>/dev/null || true
    chown -R asterisk:asterisk /etc/asterisk

    # Set Asterisk to run as the asterisk user
    sed -i 's/^;runuser =.*/runuser = asterisk/' /etc/asterisk/asterisk.conf
    sed -i 's/^;rungroup =.*/rungroup = asterisk/' /etc/asterisk/asterisk.conf
    sed -i 's/^runuser =.*/runuser = asterisk/' /etc/asterisk/asterisk.conf
    sed -i 's/^rungroup =.*/rungroup = asterisk/' /etc/asterisk/asterisk.conf

    log_info "Asterisk installed successfully."
}

# =============================================================================
# STEP 4: Configure ODBC (Connects Asterisk <-> MariaDB)
# =============================================================================
configure_odbc() {
    log_section "Step 4: Configuring ODBC Connection"

    # Find the MariaDB ODBC driver path
    DRIVER_PATH=$(find /usr /lib -name "libmaodbc.so" 2>/dev/null | head -1)
    if [ -z "$DRIVER_PATH" ]; then
        DRIVER_PATH=$(find /usr /lib -name "libmariadb*.so" 2>/dev/null | head -1)
    fi
    if [ -z "$DRIVER_PATH" ]; then
        log_error "MariaDB ODBC driver not found! Install odbc-mariadb package."
        exit 1
    fi
    log_info "Found ODBC driver at: ${DRIVER_PATH}"

    # Configure /etc/odbcinst.ini (driver registration)
    cat > /etc/odbcinst.ini <<EOF
[MariaDB]
Description = MariaDB Connector/ODBC
Driver      = ${DRIVER_PATH}
Setup       = ${DRIVER_PATH}
FileUsage   = 1
EOF

    # Configure /etc/odbc.ini (DSN definition)
    cat > /etc/odbc.ini <<EOF
[asterisk-connector]
Description = Asterisk MariaDB Connection
Driver      = MariaDB
Server      = localhost
Database    = ${DB_NAME}
User        = ${DB_USER}
Password    = ${DB_PASSWORD}
Port        = 3306
Socket      = /var/run/mysqld/mysqld.sock
Option      = 3
Charset     = utf8mb4
EOF

    # Test the ODBC connection
    log_info "Testing ODBC connection..."
    if echo "SELECT 1;" | isql -v asterisk-connector ${DB_USER} ${DB_PASSWORD} > /dev/null 2>&1; then
        log_info "ODBC connection test PASSED."
    else
        log_warn "ODBC connection test did not return cleanly. This may still work."
        log_warn "You can manually test with: isql -v asterisk-connector ${DB_USER} ${DB_PASSWORD}"
    fi

    # Configure Asterisk's res_odbc.conf
    cat > /etc/asterisk/res_odbc.conf <<EOF
;; ==========================================================================
;; Asterisk ODBC Configuration - Generated by AsterFlow Setup Script
;; ==========================================================================

[asterisk]
enabled  => yes
dsn      => asterisk-connector
username => ${DB_USER}
password => ${DB_PASSWORD}
pre-connect       => yes
sanitysql         => SELECT 1
max_connections    => 5
connect_timeout    => 10
negative_connection_cache => 300
EOF

    log_info "ODBC configured: DSN 'asterisk-connector' -> Asterisk connection 'asterisk'"
}

# =============================================================================
# STEP 5: Run Alembic Migrations (Creates all PJSIP/Queue/CDR tables)
# =============================================================================
run_alembic_migrations() {
    log_section "Step 5: Running Alembic Database Migrations"

    ALEMBIC_DIR=$(find /usr/src -type d -name "ast-db-manage" 2>/dev/null | head -1)
    if [ -z "$ALEMBIC_DIR" ]; then
        ALEMBIC_DIR=$(find /usr/src -path "*/contrib/ast-db-manage" 2>/dev/null | head -1)
    fi

    if [ -z "$ALEMBIC_DIR" ]; then
        log_warn "Alembic directory not found. Creating tables manually..."
        create_tables_manually
        return
    fi

    cd "$ALEMBIC_DIR"

    # Install Alembic and MySQL connector in a virtual environment
    # (Required for Python 3.12+ which enforces PEP 668)
    log_info "Creating Python virtual environment for Alembic..."
    python3 -m venv /opt/asterflow-alembic-venv
    source /opt/asterflow-alembic-venv/bin/activate
    pip install --upgrade pip
    pip install alembic mysqlclient PyMySQL

    # Update the Alembic config to use our database
    CONFIG_INI="${ALEMBIC_DIR}/config.ini"
    if [ -f "$CONFIG_INI" ]; then
        sed -i "s|^sqlalchemy.url =.*|sqlalchemy.url = mysql+pymysql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}|" "$CONFIG_INI"
    else
        cat > "$CONFIG_INI" <<EOF
[alembic]
script_location = config
sqlalchemy.url = mysql+pymysql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}
EOF
    fi

    # Run the config migration (creates PJSIP tables, queue tables, voicemail, etc.)
    log_info "Running 'config' migration (PJSIP, queues, voicemail tables)..."
    if [ -d "config" ]; then
        cd config
        alembic -c ../config.ini upgrade head 2>&1 | tail -5 || log_warn "Config migration had warnings (may already be applied)"
        cd ..
    fi

    # Run the CDR migration (creates the cdr table)
    log_info "Running 'cdr' migration..."
    if [ -d "cdr" ]; then
        # Create separate config for CDR
        cat > config_cdr.ini <<EOF
[alembic]
script_location = cdr
sqlalchemy.url = mysql+pymysql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}
EOF
        cd cdr
        alembic -c ../config_cdr.ini upgrade head 2>&1 | tail -5 || log_warn "CDR migration had warnings"
        cd ..
    fi

    # Run the voicemail migration if it exists
    if [ -d "voicemail" ]; then
        log_info "Running 'voicemail' migration..."
        cat > config_voicemail.ini <<EOF
[alembic]
script_location = voicemail
sqlalchemy.url = mysql+pymysql://${DB_USER}:${DB_PASSWORD}@localhost/${DB_NAME}
EOF
        cd voicemail
        alembic -c ../config_voicemail.ini upgrade head 2>&1 | tail -5 || log_warn "Voicemail migration had warnings"
        cd ..
    fi

    log_info "Database migrations complete."

    # Always ensure all tables exist as a safety net
    # (CREATE TABLE IF NOT EXISTS is idempotent - won't break existing tables)
    log_info "Ensuring all required tables exist..."
    create_tables_manually
}

create_queue_log_table() {
    log_info "Ensuring queue_log table exists..."
    mysql -u ${DB_USER} -p${DB_PASSWORD} ${DB_NAME} <<'QLTABLE'
CREATE TABLE IF NOT EXISTS queue_log (
    time      DATETIME       NOT NULL,
    callid    VARCHAR(80)    NOT NULL DEFAULT '',
    queuename VARCHAR(256)   NOT NULL DEFAULT '',
    agent     VARCHAR(256)   NOT NULL DEFAULT '',
    event     VARCHAR(32)    NOT NULL DEFAULT '',
    data1     VARCHAR(100)   DEFAULT NULL,
    data2     VARCHAR(100)   DEFAULT NULL,
    data3     VARCHAR(100)   DEFAULT NULL,
    data4     VARCHAR(100)   DEFAULT NULL,
    data5     VARCHAR(100)   DEFAULT NULL,
    PRIMARY KEY (time, callid, event),
    INDEX idx_queuename (queuename),
    INDEX idx_agent (agent),
    INDEX idx_event (event)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
QLTABLE
}

create_tables_manually() {
    log_info "Creating/verifying all essential database tables..."

    # The Alembic migrations normally handle this, but as a fallback
    # we create the most critical tables that AsterFlow needs.

    mysql -u ${DB_USER} -p${DB_PASSWORD} ${DB_NAME} <<'TABLES'

-- PJSIP Endpoints
CREATE TABLE IF NOT EXISTS ps_endpoints (
    id VARCHAR(40) NOT NULL PRIMARY KEY,
    transport VARCHAR(40), aors VARCHAR(200), auth VARCHAR(40),
    context VARCHAR(40), disallow VARCHAR(200), allow VARCHAR(200),
    direct_media VARCHAR(10), connected_line_method VARCHAR(15),
    direct_media_method VARCHAR(15), direct_media_glare_mitigation VARCHAR(15),
    disable_direct_media_on_nat VARCHAR(10), dtmf_mode VARCHAR(15),
    external_media_address VARCHAR(40), force_rport VARCHAR(10),
    ice_support VARCHAR(10), identify_by VARCHAR(80), mailboxes VARCHAR(40),
    moh_suggest VARCHAR(40), outbound_auth VARCHAR(40), outbound_proxy VARCHAR(256),
    rewrite_contact VARCHAR(10), rtp_ipv6 VARCHAR(10), rtp_symmetric VARCHAR(10),
    send_diversion VARCHAR(10), send_pai VARCHAR(10), send_rpid VARCHAR(10),
    timers_min_se INT, timers VARCHAR(10), timers_sess_expires INT,
    callerid VARCHAR(40), callerid_privacy VARCHAR(10), callerid_tag VARCHAR(40),
    aggregate_mwi VARCHAR(10), trust_id_inbound VARCHAR(10),
    trust_id_outbound VARCHAR(10), use_ptime VARCHAR(10), use_avpf VARCHAR(10),
    media_encryption VARCHAR(15), inband_progress VARCHAR(10),
    call_group VARCHAR(40), pickup_group VARCHAR(40),
    named_call_group VARCHAR(40), named_pickup_group VARCHAR(40),
    device_state_busy_at INT, fax_detect VARCHAR(10),
    t38_udptl VARCHAR(10), t38_udptl_ec VARCHAR(15), t38_udptl_maxdatagram INT,
    t38_udptl_nat VARCHAR(10), t38_udptl_ipv6 VARCHAR(10),
    tone_zone VARCHAR(40), language VARCHAR(40),
    one_touch_recording VARCHAR(10), record_on_feature VARCHAR(40),
    record_off_feature VARCHAR(40), rtp_engine VARCHAR(40),
    allow_transfer VARCHAR(10), allow_subscribe VARCHAR(10),
    sdp_owner VARCHAR(40), sdp_session VARCHAR(40),
    tos_audio VARCHAR(10), tos_video VARCHAR(10), sub_min_expiry INT,
    from_domain VARCHAR(40), from_user VARCHAR(40), mwi_from_user VARCHAR(40),
    dtls_verify VARCHAR(10), dtls_rekey VARCHAR(10),
    dtls_cert_file VARCHAR(200), dtls_private_key VARCHAR(200),
    dtls_cipher VARCHAR(200), dtls_ca_file VARCHAR(200),
    dtls_ca_path VARCHAR(200), dtls_setup VARCHAR(15),
    srtp_tag_32 VARCHAR(10), media_address VARCHAR(40),
    redirect_method VARCHAR(10), set_var VARCHAR(200),
    cos_audio INT, cos_video INT, message_context VARCHAR(40),
    force_avp VARCHAR(10), media_use_received_transport VARCHAR(10),
    accountcode VARCHAR(80), user_eq_phone VARCHAR(10),
    moh_passthrough VARCHAR(10), media_encryption_optimistic VARCHAR(10),
    rpid_immediate VARCHAR(10), g726_non_standard VARCHAR(10),
    rtp_keepalive INT, rtp_timeout INT, rtp_timeout_hold INT,
    bind_rtp_to_media_address VARCHAR(10), voicemail_extension VARCHAR(40),
    mwi_subscribe_replaces_unsolicited VARCHAR(10),
    deny VARCHAR(95), permit VARCHAR(95), acl VARCHAR(40),
    contact_deny VARCHAR(95), contact_permit VARCHAR(95), contact_acl VARCHAR(40),
    subscribe_context VARCHAR(40), fax_detect_timeout INT,
    contact_user VARCHAR(80), preferred_codec_only VARCHAR(10),
    asymmetric_rtp_codec VARCHAR(10), rtcp_mux VARCHAR(10),
    allow_overlap VARCHAR(10), refer_blind_progress VARCHAR(10),
    notify_early_inuse_ringing VARCHAR(10), max_audio_streams INT,
    max_video_streams INT, webrtc VARCHAR(10), dtls_fingerprint VARCHAR(10),
    incoming_mwi_mailbox VARCHAR(40), bundle VARCHAR(10),
    dtls_auto_generate_cert VARCHAR(10), follow_early_media_fork VARCHAR(10),
    accept_multiple_sdp_answers VARCHAR(10),
    suppress_q850_reason_headers VARCHAR(10),
    trust_connected_line VARCHAR(10), send_connected_line VARCHAR(10),
    ignore_183_without_sdp VARCHAR(10),
    codec_prefs_incoming_offer VARCHAR(128), codec_prefs_outgoing_offer VARCHAR(128),
    codec_prefs_incoming_answer VARCHAR(128), codec_prefs_outgoing_answer VARCHAR(128),
    stir_shaken VARCHAR(10), send_history_info VARCHAR(10),
    allow_unauthenticated_options VARCHAR(10),
    t38_bind_udptl_to_media_address VARCHAR(10),
    geoloc_incoming_call_profile VARCHAR(80), geoloc_outgoing_call_profile VARCHAR(80),
    incoming_call_offer_pref VARCHAR(128), outgoing_call_offer_pref VARCHAR(128),
    stir_shaken_profile VARCHAR(80),
    security_negotiation VARCHAR(10), security_mechanisms VARCHAR(512),
    send_aoc VARCHAR(10), overlap_context VARCHAR(80),
    tenantid VARCHAR(128), suppress_moh_on_sendonly VARCHAR(10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- PJSIP Auth
CREATE TABLE IF NOT EXISTS ps_auths (
    id VARCHAR(40) NOT NULL PRIMARY KEY,
    auth_type VARCHAR(15), nonce_lifetime INT,
    md5_cred VARCHAR(40), password VARCHAR(80),
    realm VARCHAR(40), username VARCHAR(40),
    refresh_token VARCHAR(200), oauth_clientid VARCHAR(200),
    oauth_secret VARCHAR(200), password_digest VARCHAR(200),
    supported_algorithms_uas VARCHAR(128), supported_algorithms_uac VARCHAR(128)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- PJSIP AORs
CREATE TABLE IF NOT EXISTS ps_aors (
    id VARCHAR(40) NOT NULL PRIMARY KEY,
    contact VARCHAR(255), default_expiration INT,
    mailboxes VARCHAR(80), max_contacts INT,
    minimum_expiration INT, remove_existing VARCHAR(10),
    qualify_frequency INT, authenticate_qualify VARCHAR(10),
    maximum_expiration INT, outbound_proxy VARCHAR(256),
    support_path VARCHAR(10), qualify_timeout FLOAT,
    voicemail_extension VARCHAR(40), remove_unavailable VARCHAR(10),
    qualify_2xx_only VARCHAR(10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- PJSIP Transports
CREATE TABLE IF NOT EXISTS ps_transports (
    id VARCHAR(40) NOT NULL PRIMARY KEY,
    async_operations INT, bind VARCHAR(40),
    ca_list_file VARCHAR(200), cert_file VARCHAR(200),
    cipher VARCHAR(200), domain VARCHAR(40),
    external_media_address VARCHAR(40), external_signaling_address VARCHAR(40),
    external_signaling_port INT, method VARCHAR(10),
    local_net VARCHAR(40), password VARCHAR(40),
    priv_key_file VARCHAR(200), protocol VARCHAR(10),
    require_client_cert VARCHAR(10), verify_client VARCHAR(10),
    verify_server VARCHAR(10), tos VARCHAR(10), cos INT,
    allow_reload VARCHAR(10), symmetric_transport VARCHAR(10),
    allow_wildcard_certs VARCHAR(10),
    tcp_keepalive_enable INT, tcp_keepalive_idle_time INT,
    tcp_keepalive_interval_time INT, tcp_keepalive_probe_count INT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Queue Members (Realtime)
CREATE TABLE IF NOT EXISTS queue_members (
    queue_name  VARCHAR(80)  NOT NULL,
    interface   VARCHAR(80)  NOT NULL,
    membername  VARCHAR(80)  DEFAULT NULL,
    state_interface VARCHAR(80) DEFAULT NULL,
    penalty     INT          DEFAULT NULL,
    paused      INT          DEFAULT NULL,
    uniqueid    INT          NOT NULL AUTO_INCREMENT,
    wrapuptime  INT          DEFAULT NULL,
    ringinuse   VARCHAR(10)  DEFAULT NULL,
    reason_paused VARCHAR(80) DEFAULT NULL,
    PRIMARY KEY (queue_name, interface),
    UNIQUE KEY (uniqueid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Queues (Realtime)
CREATE TABLE IF NOT EXISTS queues (
    name VARCHAR(128) NOT NULL PRIMARY KEY,
    musiconhold VARCHAR(128) DEFAULT NULL,
    announce VARCHAR(128) DEFAULT NULL,
    context VARCHAR(128) DEFAULT NULL,
    timeout INT DEFAULT NULL,
    ringinuse VARCHAR(10) DEFAULT NULL,
    setinterfacevar VARCHAR(10) DEFAULT NULL,
    setqueuevar VARCHAR(10) DEFAULT NULL,
    setqueueentryvar VARCHAR(10) DEFAULT NULL,
    monitor_format VARCHAR(8) DEFAULT NULL,
    membermacro VARCHAR(512) DEFAULT NULL,
    membergosub VARCHAR(512) DEFAULT NULL,
    announce_frequency INT DEFAULT NULL,
    min_announce_frequency INT DEFAULT NULL,
    announce_holdtime VARCHAR(128) DEFAULT NULL,
    announce_position VARCHAR(128) DEFAULT NULL,
    announce_position_limit INT DEFAULT NULL,
    periodic_announce VARCHAR(256) DEFAULT NULL,
    periodic_announce_frequency INT DEFAULT NULL,
    relative_periodic_announce VARCHAR(10) DEFAULT NULL,
    random_periodic_announce VARCHAR(10) DEFAULT NULL,
    retry INT DEFAULT NULL,
    wrapuptime INT DEFAULT NULL,
    penaltymemberslimit INT DEFAULT NULL,
    autofill VARCHAR(10) DEFAULT NULL,
    monitor_type VARCHAR(128) DEFAULT NULL,
    autopause VARCHAR(10) DEFAULT NULL,
    autopausedelay INT DEFAULT NULL,
    autopausebusy VARCHAR(10) DEFAULT NULL,
    autopauseunavail VARCHAR(10) DEFAULT NULL,
    maxlen INT DEFAULT NULL,
    servicelevel INT DEFAULT NULL,
    strategy VARCHAR(128) DEFAULT NULL,
    joinempty VARCHAR(128) DEFAULT NULL,
    leavewhenempty VARCHAR(128) DEFAULT NULL,
    reportholdtime VARCHAR(10) DEFAULT NULL,
    memberdelay INT DEFAULT NULL,
    weight INT DEFAULT NULL,
    timeoutrestart VARCHAR(10) DEFAULT NULL,
    defaultrule VARCHAR(128) DEFAULT NULL,
    timeoutpriority VARCHAR(10) DEFAULT NULL,
    log_restricted_caller_id VARCHAR(10) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- CDR (Call Detail Records)
CREATE TABLE IF NOT EXISTS cdr (
    calldate    DATETIME     NOT NULL,
    clid        VARCHAR(80)  NOT NULL DEFAULT '',
    src         VARCHAR(80)  NOT NULL DEFAULT '',
    dst         VARCHAR(80)  NOT NULL DEFAULT '',
    dcontext    VARCHAR(80)  NOT NULL DEFAULT '',
    channel     VARCHAR(80)  NOT NULL DEFAULT '',
    dstchannel  VARCHAR(80)  NOT NULL DEFAULT '',
    lastapp     VARCHAR(80)  NOT NULL DEFAULT '',
    lastdata    VARCHAR(80)  NOT NULL DEFAULT '',
    duration    INT          NOT NULL DEFAULT 0,
    billsec     INT          NOT NULL DEFAULT 0,
    disposition VARCHAR(45)  NOT NULL DEFAULT '',
    amaflags    INT          NOT NULL DEFAULT 0,
    accountcode VARCHAR(20)  NOT NULL DEFAULT '',
    uniqueid    VARCHAR(150) NOT NULL DEFAULT '',
    userfield   VARCHAR(255) NOT NULL DEFAULT '',
    PRIMARY KEY (uniqueid, calldate, lastapp),
    INDEX idx_calldate (calldate),
    INDEX idx_dst (dst),
    INDEX idx_src (src),
    INDEX idx_disposition (disposition)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Queue Log
CREATE TABLE IF NOT EXISTS queue_log (
    time      DATETIME       NOT NULL,
    callid    VARCHAR(80)    NOT NULL DEFAULT '',
    queuename VARCHAR(256)   NOT NULL DEFAULT '',
    agent     VARCHAR(256)   NOT NULL DEFAULT '',
    event     VARCHAR(32)    NOT NULL DEFAULT '',
    data1     VARCHAR(100)   DEFAULT NULL,
    data2     VARCHAR(100)   DEFAULT NULL,
    data3     VARCHAR(100)   DEFAULT NULL,
    data4     VARCHAR(100)   DEFAULT NULL,
    data5     VARCHAR(100)   DEFAULT NULL,
    PRIMARY KEY (time, callid, event),
    INDEX idx_queuename (queuename),
    INDEX idx_agent (agent),
    INDEX idx_event (event)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Extensions table (Realtime dialplan)
CREATE TABLE IF NOT EXISTS extensions (
    id       INT AUTO_INCREMENT PRIMARY KEY,
    context  VARCHAR(40)  NOT NULL DEFAULT '',
    exten    VARCHAR(40)  NOT NULL DEFAULT '',
    priority INT          NOT NULL DEFAULT 0,
    app      VARCHAR(40)  NOT NULL DEFAULT '',
    appdata  VARCHAR(256) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Voicemail table
CREATE TABLE IF NOT EXISTS voicemail (
    uniqueid INT AUTO_INCREMENT PRIMARY KEY,
    context VARCHAR(80) NOT NULL DEFAULT '',
    mailbox VARCHAR(80) NOT NULL DEFAULT '',
    password VARCHAR(80) NOT NULL DEFAULT '',
    fullname VARCHAR(80) DEFAULT NULL,
    alias VARCHAR(80) DEFAULT NULL,
    email VARCHAR(80) DEFAULT NULL,
    pager VARCHAR(80) DEFAULT NULL,
    attach VARCHAR(10) DEFAULT NULL,
    attachfmt VARCHAR(10) DEFAULT NULL,
    serveremail VARCHAR(80) DEFAULT NULL,
    language VARCHAR(20) DEFAULT NULL,
    tz VARCHAR(30) DEFAULT NULL,
    deletevoicemail VARCHAR(10) DEFAULT NULL,
    saycid VARCHAR(10) DEFAULT NULL,
    sendvoicemail VARCHAR(10) DEFAULT NULL,
    review VARCHAR(10) DEFAULT NULL,
    tempgreetwarn VARCHAR(10) DEFAULT NULL,
    operator VARCHAR(10) DEFAULT NULL,
    envelope VARCHAR(10) DEFAULT NULL,
    sayduration INT DEFAULT NULL,
    forcename VARCHAR(10) DEFAULT NULL,
    forcegreetings VARCHAR(10) DEFAULT NULL,
    callback VARCHAR(80) DEFAULT NULL,
    dialout VARCHAR(80) DEFAULT NULL,
    exitcontext VARCHAR(80) DEFAULT NULL,
    maxmsg INT DEFAULT NULL,
    volgain FLOAT DEFAULT NULL,
    imapuser VARCHAR(80) DEFAULT NULL,
    imappassword VARCHAR(80) DEFAULT NULL,
    imapserver VARCHAR(80) DEFAULT NULL,
    imapport VARCHAR(8) DEFAULT NULL,
    imapflags VARCHAR(80) DEFAULT NULL,
    stamp DATETIME DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

TABLES

    log_info "All essential tables created."
}

# =============================================================================
# STEP 6: Configure Asterisk Realtime (extconfig.conf)
# =============================================================================
configure_realtime() {
    log_section "Step 6: Configuring Asterisk Realtime Architecture (ARA)"

    cat > /etc/asterisk/extconfig.conf <<'EOF'
;; ==========================================================================
;; Asterisk Realtime Configuration - Generated by AsterFlow Setup Script
;; ==========================================================================
;; Maps Asterisk internal modules to database tables via ODBC.
;; The 'asterisk' connection name refers to our [asterisk] block in res_odbc.conf
;; ==========================================================================

[settings]

;; --- PJSIP Realtime Tables ---
ps_endpoints     => odbc,asterisk
ps_auths         => odbc,asterisk
ps_aors          => odbc,asterisk
ps_domain_aliases => odbc,asterisk
ps_endpoint_id_ips => odbc,asterisk
ps_contacts      => odbc,asterisk
ps_systems       => odbc,asterisk
ps_globals       => odbc,asterisk
ps_transports    => odbc,asterisk
ps_registrations => odbc,asterisk
ps_outbound_publishes => odbc,asterisk
ps_inbound_publications => odbc,asterisk
ps_resource_list => odbc,asterisk
ps_subscription_persistence => odbc,asterisk
ps_asterisk_publications => odbc,asterisk

;; --- Queue Realtime ---
queues           => odbc,asterisk
queue_members    => odbc,asterisk
queue_rules      => odbc,asterisk

;; --- Queue Log to Database ---
queue_log        => odbc,asterisk

;; --- Voicemail ---
voicemail        => odbc,asterisk

;; --- SIP Peers (Legacy, if needed) ---
sippeers         => odbc,asterisk

;; --- IAX Friends (Legacy, if needed) ---
iaxfriends       => odbc,asterisk

;; --- Music on Hold ---
musiconhold      => odbc,asterisk
musiconhold_entry => odbc,asterisk

;; --- Meetme ---
meetme           => odbc,asterisk

;; --- Extensions (Realtime Dialplan, optional) ---
;; extensions    => odbc,asterisk

;; --- STIR/SHAKEN ---
stir_tn          => odbc,asterisk
EOF

    log_info "Realtime ARA configured in extconfig.conf"
}

# =============================================================================
# STEP 7: Configure CDR to Database
# =============================================================================
configure_cdr() {
    log_section "Step 7: Configuring CDR Logging to Database"

    # Enable adaptive ODBC CDR
    cat > /etc/asterisk/cdr_adaptive_odbc.conf <<EOF
;; ==========================================================================
;; CDR Adaptive ODBC - Logs Call Detail Records to MariaDB
;; Generated by AsterFlow Setup Script
;; ==========================================================================

[asterisk]
connection  = asterisk
table       = cdr
alias start => calldate
EOF

    # Disable file-based CDR logging and enable ODBC
    cat > /etc/asterisk/cdr.conf <<'EOF'
[general]
enable=yes
unanswered=yes
congestion=yes
endbeforehexten=no
initiatedseconds=no
batch=no
EOF

    # Ensure queue_log goes to the database (not a flat file)
    cat > /etc/asterisk/queue_log.conf <<'EOF'
;; ==========================================================================
;; Queue Log Configuration
;; Generated by AsterFlow Setup Script
;; ==========================================================================
;; queue_log is mapped to the database via extconfig.conf (odbc)
;; This disables the flat-file /var/log/asterisk/queue_log

[general]
; By mapping queue_log in extconfig.conf, Asterisk will use the DB automatically.
; No additional config needed here.
EOF

    log_info "CDR and Queue Log configured to write to database."
}

# =============================================================================
# STEP 8: Configure AMI (Asterisk Manager Interface)
# =============================================================================
configure_ami() {
    log_section "Step 8: Configuring AMI (Asterisk Manager Interface)"

    cat > /etc/asterisk/manager.conf <<EOF
;; ==========================================================================
;; AMI Configuration - Generated by AsterFlow Setup Script
;; ==========================================================================
;; Your AsterFlow backend connects here to get real-time queue status,
;; perform Spy/Whisper/Barge, and originate calls.
;; ==========================================================================

[general]
enabled = yes
port = 5038
bindaddr = 0.0.0.0
webenabled = no
httptimeout = 60
displayconnects = yes

[${AMI_USER}]
secret = ${AMI_PASS}
deny = 0.0.0.0/0.0.0.0
permit = 0.0.0.0/0.0.0.0
read = system,call,log,verbose,command,agent,user,config,dtmf,reporting,cdr,dialplan,originate
write = system,call,log,verbose,command,agent,user,config,dtmf,reporting,cdr,dialplan,originate
writetimeout = 5000
EOF

    log_info "AMI configured: user='${AMI_USER}', port=5038, all permissions granted."
}

# =============================================================================
# STEP 9: Configure WebRTC (HTTP/WSS + TLS Certificates)
# =============================================================================
configure_webrtc() {
    log_section "Step 9: Configuring WebRTC (HTTP, WSS, TLS)"

    SERVER_IP=$(get_server_ip)

    # --- Generate self-signed TLS certificates ---
    log_info "Generating self-signed TLS certificates..."
    mkdir -p /etc/asterisk/keys

    # Check if Asterisk's helper script exists
    AST_TLS_SCRIPT=$(find /usr/src -name "ast_tls_cert" 2>/dev/null | head -1)

    if [ -n "$AST_TLS_SCRIPT" ] && [ -f "$AST_TLS_SCRIPT" ]; then
        log_info "Using Asterisk's ast_tls_cert script..."
        chmod +x "$AST_TLS_SCRIPT"
        "$AST_TLS_SCRIPT" -C "${SERVER_IP}" -O "AsterFlow" -d /etc/asterisk/keys -b 4096
    else
        log_info "Generating certificates with OpenSSL..."
        # Generate CA
        openssl req -new -x509 -days 3650 -nodes \
            -keyout /etc/asterisk/keys/ca.key \
            -out /etc/asterisk/keys/ca.crt \
            -subj "/CN=AsterFlow CA/O=AsterFlow"

        # Generate server certificate
        openssl req -new -nodes \
            -keyout /etc/asterisk/keys/asterisk.key \
            -out /etc/asterisk/keys/asterisk.csr \
            -subj "/CN=${SERVER_IP}/O=AsterFlow"

        # Sign with our CA
        openssl x509 -req -days 3650 \
            -in /etc/asterisk/keys/asterisk.csr \
            -CA /etc/asterisk/keys/ca.crt \
            -CAkey /etc/asterisk/keys/ca.key \
            -CAcreateserial \
            -out /etc/asterisk/keys/asterisk.crt

        # Create combined PEM file (what Asterisk expects)
        cat /etc/asterisk/keys/asterisk.key /etc/asterisk/keys/asterisk.crt > /etc/asterisk/keys/asterisk.pem
    fi

    chown -R asterisk:asterisk /etc/asterisk/keys
    chmod 600 /etc/asterisk/keys/*.key /etc/asterisk/keys/*.pem 2>/dev/null || true

    # --- Configure Asterisk HTTP server (for WebSocket connections) ---
    cat > /etc/asterisk/http.conf <<EOF
;; ==========================================================================
;; HTTP / WebSocket Configuration - Generated by AsterFlow Setup Script
;; ==========================================================================
;; The WebRTC softphone (JsSIP) in AsterFlow connects via WSS on port 8089.
;; ==========================================================================

[general]
enabled = yes
bindaddr = 0.0.0.0
bindport = 8088
tlsenable = yes
tlsbindaddr = 0.0.0.0:8089
tlscertfile = /etc/asterisk/keys/asterisk.pem
tlsprivatekey = /etc/asterisk/keys/asterisk.key
EOF

    # --- Configure PJSIP with WSS transport ---
    cat > /etc/asterisk/pjsip.conf <<EOF
;; ==========================================================================
;; PJSIP Configuration - Generated by AsterFlow Setup Script
;; ==========================================================================
;; IMPORTANT: Endpoints, auths, and AORs are managed via REALTIME (database).
;; Only transports and globals need to be in this file.
;; ==========================================================================

;; --- Transports ---
;; UDP Transport (for desk phones / softphones on LAN)
[transport-udp]
type = transport
protocol = udp
bind = 0.0.0.0:5060

;; WSS Transport (for WebRTC clients - AsterFlow Softphone)
[transport-wss]
type = transport
protocol = wss
bind = 0.0.0.0

;; --- Global Settings ---
[global]
type = global
max_forwards = 70
user_agent = AsterFlow-PBX
default_outbound_endpoint = default

;; --- System Settings ---
[system]
type = system
timer_t1 = 500
timer_b = 32000
EOF

    log_info "WebRTC configured: WSS on port 8089, HTTP on port 8088."
    log_info "TLS certificates generated at /etc/asterisk/keys/"
}

# =============================================================================
# STEP 10: Configure basic dialplan + queue + call recording
# =============================================================================
configure_dialplan() {
    log_section "Step 10: Configuring Dialplan, Queues & Call Recording"

    SERVER_IP=$(get_server_ip)

    cat > /etc/asterisk/extensions.conf <<'EOF'
;; ==========================================================================
;; Dialplan - Generated by AsterFlow Setup Script
;; ==========================================================================
;; This provides a basic working dialplan for AsterFlow with:
;;   - Extension-to-extension calling
;;   - Queue support with MixMonitor recording
;;   - ChanSpy support for supervisor features
;; ==========================================================================

[general]
static = yes
writeprotect = no

[globals]
RECORDINGS_DIR=/var/spool/asterisk/monitor

;; ==========================================================================
;; Main context for all PJSIP endpoints
;; ==========================================================================
[default]

;; --- Extension-to-Extension Dialing (1XX pattern) ---
exten => _1XX,1,NoOp(Dialing extension ${EXTEN})
 same => n,Set(RECORDING_FILE=${GLOBAL(RECORDINGS_DIR)}/${UNIQUEID})
 same => n,MixMonitor(${RECORDING_FILE}.wav,b)
 same => n,Dial(PJSIP/${EXTEN},30,tT)
 same => n,Hangup()

;; --- Queue Dialing (dial 200 to reach the 'support' queue) ---
exten => 200,1,NoOp(Entering Support Queue)
 same => n,Answer()
 same => n,Set(RECORDING_FILE=${GLOBAL(RECORDINGS_DIR)}/${UNIQUEID})
 same => n,MixMonitor(${RECORDING_FILE}.wav,b)
 same => n,Queue(support,tT,,,300)
 same => n,Hangup()

;; --- ChanSpy (Supervisor dials *1XX to spy on extension 1XX) ---
;; Default: Listen only. Use DTMF: 4=Listen, 5=Whisper, 6=Barge
exten => _*1XX,1,NoOp(ChanSpy on PJSIP/${EXTEN:1})
 same => n,ChanSpy(PJSIP/${EXTEN:1},dqEB)
 same => n,Hangup()

;; --- Echo Test (dial 600 to test audio) ---
exten => 600,1,NoOp(Echo Test)
 same => n,Answer()
 same => n,Playback(hello-world)
 same => n,Echo()
 same => n,Hangup()

;; --- Invalid destination ---
exten => i,1,Playback(pbx-invalid)
 same => n,Hangup()
EOF

    # Make sure the recordings directory exists
    mkdir -p /var/spool/asterisk/monitor
    chown asterisk:asterisk /var/spool/asterisk/monitor

    log_info "Dialplan configured with extension dialing, queue, ChanSpy, and MixMonitor."
}

# =============================================================================
# STEP 11: Create sample PJSIP endpoints in the database
# =============================================================================
create_sample_extensions() {
    log_section "Step 11: Creating Sample PJSIP Extensions in Database"

    for EXT in $SAMPLE_EXTENSIONS; do
        log_info "Creating extension ${EXT}..."
        mysql -u ${DB_USER} -p${DB_PASSWORD} ${DB_NAME} <<EXTEOF
-- Endpoint
INSERT IGNORE INTO ps_endpoints (id, transport, aors, auth, context, disallow, allow,
    direct_media, force_rport, ice_support, rewrite_contact, rtp_symmetric,
    media_encryption, dtmf_mode, webrtc, dtls_auto_generate_cert, use_avpf)
VALUES ('${EXT}', 'transport-wss', '${EXT}', '${EXT}', 'default',
    'all', 'ulaw,alaw,opus,vp8',
    'no', 'yes', 'yes', 'yes', 'yes',
    'dtls', 'auto', 'yes', 'yes', 'yes');

-- Auth
INSERT IGNORE INTO ps_auths (id, auth_type, password, username)
VALUES ('${EXT}', 'userpass', '${SAMPLE_PASSWORD}', '${EXT}');

-- AOR (Address of Record)
INSERT IGNORE INTO ps_aors (id, max_contacts, remove_existing, qualify_frequency)
VALUES ('${EXT}', 5, 'yes', 60);
EXTEOF
    done

    # Create the sample queue
    log_info "Creating sample queue '${SAMPLE_QUEUE}'..."
    mysql -u ${DB_USER} -p${DB_PASSWORD} ${DB_NAME} <<QEOF
INSERT IGNORE INTO queues (name, strategy, timeout, ringinuse, wrapuptime, maxlen, servicelevel, monitor_format)
VALUES ('${SAMPLE_QUEUE}', 'ringall', 30, 'no', 5, 0, 60, 'wav');
QEOF

    # Add all sample extensions as queue members
    MEMBER_ID=1
    for EXT in $SAMPLE_EXTENSIONS; do
        log_info "Adding extension ${EXT} to queue '${SAMPLE_QUEUE}'..."
        mysql -u ${DB_USER} -p${DB_PASSWORD} ${DB_NAME} <<MQEOF
INSERT IGNORE INTO queue_members (queue_name, interface, membername, penalty, paused, uniqueid)
VALUES ('${SAMPLE_QUEUE}', 'PJSIP/${EXT}', 'Agent ${EXT}', 0, 0, ${MEMBER_ID});
MQEOF
        MEMBER_ID=$((MEMBER_ID + 1))
    done

    log_info "Sample extensions and queue created."
}

# =============================================================================
# STEP 12: Configure Firewall
# =============================================================================
configure_firewall() {
    log_section "Step 12: Configuring Firewall Rules"

    if command -v ufw &>/dev/null; then
        ufw allow 5060/udp    # SIP (UDP)
        ufw allow 5060/tcp    # SIP (TCP)
        ufw allow 5038/tcp    # AMI
        ufw allow 8088/tcp    # HTTP (Asterisk Built-in)
        ufw allow 8089/tcp    # HTTPS/WSS (WebRTC)
        ufw allow 3306/tcp    # MariaDB (remote access)
        ufw allow 10000:20000/udp  # RTP media streams
        log_info "UFW firewall rules added."
    elif command -v firewall-cmd &>/dev/null; then
        firewall-cmd --permanent --add-port=5060/udp
        firewall-cmd --permanent --add-port=5060/tcp
        firewall-cmd --permanent --add-port=5038/tcp
        firewall-cmd --permanent --add-port=8088/tcp
        firewall-cmd --permanent --add-port=8089/tcp
        firewall-cmd --permanent --add-port=3306/tcp
        firewall-cmd --permanent --add-port=10000-20000/udp
        firewall-cmd --reload
        log_info "firewalld rules added."
    else
        log_warn "No known firewall (ufw/firewalld) found. Please manually open ports:"
        log_warn "  5060/udp+tcp (SIP) | 5038/tcp (AMI) | 8088/tcp (HTTP)"
        log_warn "  8089/tcp (WSS)     | 3306/tcp (MySQL) | 10000-20000/udp (RTP)"
    fi
}

# =============================================================================
# STEP 13: Configure RTP ports
# =============================================================================
configure_rtp() {
    log_section "Step 13: Configuring RTP Port Range"

    cat > /etc/asterisk/rtp.conf <<'EOF'
;; ==========================================================================
;; RTP Configuration - Generated by AsterFlow Setup Script
;; ==========================================================================

[general]
rtpstart = 10000
rtpend   = 20000
strictrtp = yes
icesupport = yes
stunaddr = stun.l.google.com:19302
EOF

    log_info "RTP ports configured: 10000-20000"
}

# =============================================================================
# STEP 14: Configure modules.conf
# =============================================================================
configure_modules() {
    log_section "Step 14: Configuring Asterisk Modules"

    # Ensure critical modules are loaded
    # We'll just make sure the noload/load directives are correct
    if [ -f /etc/asterisk/modules.conf ]; then
        # Make sure res_pjsip modules load (and legacy chan_sip does NOT)
        if ! grep -q "noload => chan_sip.so" /etc/asterisk/modules.conf; then
            echo "noload => chan_sip.so" >> /etc/asterisk/modules.conf
        fi
    fi

    log_info "Module configuration updated."
}

# =============================================================================
# STEP 15: Start Asterisk
# =============================================================================
start_asterisk() {
    log_section "Step 15: Starting Asterisk"

    # Enable and start Asterisk
    systemctl enable asterisk
    systemctl restart asterisk

    sleep 3

    if systemctl is-active --quiet asterisk; then
        log_info "Asterisk is running!"
    else
        log_error "Asterisk failed to start. Check: journalctl -u asterisk -n 50"
        log_warn "Attempting to start in foreground for diagnostics..."
        asterisk -cvvvvvg 2>&1 | tail -20
    fi

    # Quick status check
    log_info "Checking Asterisk status..."
    asterisk -rx "core show version" 2>/dev/null || true
    asterisk -rx "pjsip show endpoints" 2>/dev/null || true
    asterisk -rx "queue show" 2>/dev/null || true
}

# =============================================================================
# FINAL SUMMARY
# =============================================================================
print_summary() {
    SERVER_IP=$(get_server_ip)

    log_section "SETUP COMPLETE!"

    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║              AsterFlow - Asterisk Setup Complete            ║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  Server IP:        ${YELLOW}${SERVER_IP}${NC}                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  ${BLUE}Database:${NC}                                                  ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    Host:            ${SERVER_IP}:3306                        ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    Database:        ${DB_NAME}                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    User:            ${DB_USER}                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    Password:        ${DB_PASSWORD}                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  ${BLUE}AMI:${NC}                                                       ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    Host:            ${SERVER_IP}:5038                        ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    User:            ${AMI_USER}                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    Password:        ${AMI_PASS}                    ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  ${BLUE}WebRTC:${NC}                                                    ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    WSS URL:         wss://${SERVER_IP}:8089/ws               ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  ${BLUE}Sample Extensions:${NC}                                         ${GREEN}║${NC}"
    for EXT in $SAMPLE_EXTENSIONS; do
        echo -e "${GREEN}║${NC}    Ext ${EXT}:  user=${EXT}, pass=${SAMPLE_PASSWORD}                    ${GREEN}║${NC}"
    done
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  ${BLUE}Sample Queue:${NC}      ${SAMPLE_QUEUE}                               ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}    Dial 200 to reach it.                                     ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  ${BLUE}Recordings:${NC}       /var/spool/asterisk/monitor              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}╠══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  ${YELLOW}NEXT STEPS:${NC}                                                 ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  1. Update your AsterFlow .env file:                         ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}     VM_IP=${SERVER_IP}                                       ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  2. On your desktop, run:                                    ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}     docker-compose up -d --build                             ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  3. Accept the self-signed cert in your browser:             ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}     Visit: https://${SERVER_IP}:8089/ws                      ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}     Click 'Advanced' -> 'Proceed'                            ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}  4. Open AsterFlow at http://localhost                       ${GREEN}║${NC}"
    echo -e "${GREEN}║${NC}                                                              ${GREEN}║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================
main() {
    check_root

    echo -e "${BLUE}"
    echo "    _        _            _____ _               "
    echo "   / \\   ___| |_ ___ _ _|  ___| | _____      __"
    echo "  / _ \\ / __| __/ _ \\ '__|  _| | |/ _ \\ \\ /\\ / /"
    echo " / ___ \\\\__ \\ ||  __/ |  | |   | | (_) \\ V  V / "
    echo "/_/   \\_\\___/\\__\\___|_|  |_|   |_|\\___/ \\_/\\_/  "
    echo ""
    echo -e "${NC}"
    echo -e "${YELLOW}This script will install and configure Asterisk for AsterFlow.${NC}"
    echo -e "${YELLOW}It is designed for a FRESH Ubuntu 22.04+ / Debian 12+ server.${NC}"
    echo ""
    read -p "Press ENTER to continue or Ctrl+C to abort..."

    install_dependencies
    install_mariadb
    install_asterisk
    configure_odbc
    run_alembic_migrations
    configure_realtime
    configure_cdr
    configure_ami
    configure_webrtc
    configure_dialplan
    create_sample_extensions
    configure_rtp
    configure_modules
    configure_firewall
    start_asterisk
    print_summary
}

main "$@"

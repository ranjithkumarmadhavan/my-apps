<?php
/**
 * Shared plumbing for every API on apps.ranjithkumarmadhavan.com:
 * JSON in/out, the MySQL connection, small schema migrations and the
 * signed-in user (session cookie shared across all apps on the site).
 *
 * Each app's API does: require .../api/lib/bootstrap.php; $db = db(); $user = require_user($db);
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const SESSION_COOKIE = 'apps_session';
const SESSION_DAYS = 30;

function reply(array $data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $message, int $status = 400): void
{
    reply(['error' => $message], $status);
}

function config(): array
{
    static $config = null;
    if ($config === null) {
        $config = require __DIR__ . '/../config.php';
    }
    return $config;
}

/** Reads the JSON body. Only same-site fetch() calls are accepted (CSRF guard). */
function input(): array
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        fail('Method not allowed', 405);
    }
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') {
        fail('Bad request', 400);
    }
    $body = json_decode((string) file_get_contents('php://input'), true);
    return is_array($body) ? $body : [];
}

function db(): PDO
{
    static $db = null;
    if ($db !== null) {
        return $db;
    }
    $c = config();
    try {
        $db = new PDO(
            "mysql:host={$c['db_host']};dbname={$c['db_name']};charset=utf8mb4",
            $c['db_user'],
            $c['db_pass'],
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
    } catch (Throwable $e) {
        fail('Server unavailable', 503);
    }
    migrate($db, 'accounts', ACCOUNT_SCHEMA);
    return $db;
}

/**
 * Applies any not-yet-run statements in $steps (an append-only list) for schema $name.
 * Never edit or reorder existing steps; add new ones at the end.
 */
function migrate(PDO $db, string $name, array $steps): void
{
    $db->exec('CREATE TABLE IF NOT EXISTS app_schema (name VARCHAR(40) PRIMARY KEY, version INT NOT NULL) ENGINE=InnoDB');
    $st = $db->prepare('SELECT version FROM app_schema WHERE name = ?');
    $st->execute([$name]);
    $done = (int) ($st->fetchColumn() ?: 0);
    if ($done >= count($steps)) {
        return;
    }
    for ($i = $done; $i < count($steps); $i++) {
        $db->exec($steps[$i]);
        $db->prepare('INSERT INTO app_schema (name, version) VALUES (?, ?) ON DUPLICATE KEY UPDATE version = VALUES(version)')
            ->execute([$name, $i + 1]);
    }
}

const ACCOUNT_SCHEMA = [
    'CREATE TABLE IF NOT EXISTS users (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(190) NOT NULL UNIQUE,
        name VARCHAR(60) NOT NULL,
        password_hash VARCHAR(255) NULL,
        google_sub VARCHAR(64) NULL UNIQUE,
        email_verified TINYINT(1) NOT NULL DEFAULT 0,
        upi VARCHAR(100) NULL,
        currency CHAR(3) NOT NULL DEFAULT \'INR\',
        created_at INT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS sessions (
        token_hash CHAR(64) PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        expires_at INT NOT NULL,
        INDEX (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB',
    'CREATE TABLE IF NOT EXISTS password_resets (
        token_hash CHAR(64) PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        expires_at INT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB',
    'CREATE TABLE IF NOT EXISTS login_attempts (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        ip VARCHAR(45) NOT NULL,
        email VARCHAR(190) NOT NULL,
        at INT NOT NULL,
        INDEX (ip, at),
        INDEX (email, at)
    ) ENGINE=InnoDB',
];

// ---------- users & sessions ----------

function user_view(array $u): array
{
    return [
        'id' => (int) $u['id'],
        'name' => $u['name'],
        'email' => $u['email'],
        'upi' => $u['upi'] ?? '',
        'currency' => $u['currency'],
        'hasPassword' => $u['password_hash'] !== null,
        'google' => $u['google_sub'] !== null,
    ];
}

function current_user(PDO $db): ?array
{
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/', $token)) {
        return null;
    }
    $st = $db->prepare('SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?');
    $st->execute([hash('sha256', $token), time()]);
    $user = $st->fetch();
    if (!$user) {
        return null;
    }
    // Sliding expiry: renew once less than half the lifetime is left.
    if ((int) $user['session_expires'] - time() < SESSION_DAYS * 86400 / 2) {
        $expires = time() + SESSION_DAYS * 86400;
        $db->prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')->execute([$expires, hash('sha256', $token)]);
        set_session_cookie($token, $expires);
    }
    return $user;
}

function require_user(PDO $db): array
{
    $user = current_user($db);
    if (!$user) {
        fail('Please sign in', 401);
    }
    return $user;
}

function set_session_cookie(string $value, int $expires): void
{
    setcookie(SESSION_COOKIE, $value, [
        'expires' => $expires,
        'path' => '/',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

function start_session(PDO $db, int $userId): void
{
    $token = bin2hex(random_bytes(32));
    $expires = time() + SESSION_DAYS * 86400;
    $db->prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        ->execute([hash('sha256', $token), $userId, $expires]);
    $db->prepare('DELETE FROM sessions WHERE expires_at < ?')->execute([time()]);
    set_session_cookie($token, $expires);
}

function end_session(PDO $db): void
{
    $token = $_COOKIE[SESSION_COOKIE] ?? '';
    if (is_string($token) && $token !== '') {
        $db->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([hash('sha256', $token)]);
    }
    set_session_cookie('', time() - 3600);
}

// ---------- validation helpers ----------

function clean_text($value, int $max): string
{
    $s = trim((string) preg_replace('/\s+/u', ' ', (string) $value));
    return mb_substr($s, 0, $max);
}

function clean_email($value): string
{
    $e = strtolower(trim((string) $value));
    return filter_var($e, FILTER_VALIDATE_EMAIL) && strlen($e) <= 190 ? $e : '';
}

function clean_currency($value): string
{
    $c = strtoupper(trim((string) $value));
    return preg_match('/^[A-Z]{3}$/', $c) ? $c : '';
}

/** UPI IDs look like name@bank. Empty string clears it. Returns null when invalid. */
function clean_upi($value): ?string
{
    $u = trim((string) $value);
    if ($u === '') {
        return '';
    }
    return preg_match('/^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,32}$/', $u) ? $u : null;
}

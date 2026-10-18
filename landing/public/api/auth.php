<?php
/**
 * Shared account API for every app on apps.ranjithkumarmadhavan.com.
 * spliteasy/dev/mockApi.js mirrors this file for local development — keep the two in sync.
 *
 * POST JSON { action, ... } with header X-Requested-With: fetch.
 */
declare(strict_types=1);

require __DIR__ . '/lib/bootstrap.php';

const LOGIN_WINDOW = 900;      // seconds
const LOGIN_MAX_FAILS = 10;    // per email or per IP inside the window
const RESET_TTL = 3600;

$in = input();
$action = (string) ($in['action'] ?? '');

if ($action === 'config') {
    reply(['googleClientId' => config()['google_client_id'] ?? '']);
}

$db = db();

function client_ip(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45);
}

function too_many_attempts(PDO $db, string $email): bool
{
    $since = time() - LOGIN_WINDOW;
    $db->prepare('DELETE FROM login_attempts WHERE at < ?')->execute([$since]);
    $st = $db->prepare('SELECT
        SUM(email = ?) AS by_email,
        SUM(ip = ?) AS by_ip
        FROM login_attempts WHERE at >= ?');
    $st->execute([$email, client_ip(), $since]);
    $row = $st->fetch();
    return (int) $row['by_email'] >= LOGIN_MAX_FAILS || (int) $row['by_ip'] >= LOGIN_MAX_FAILS * 3;
}

function record_failure(PDO $db, string $email): void
{
    $db->prepare('INSERT INTO login_attempts (ip, email, at) VALUES (?, ?, ?)')->execute([client_ip(), $email, time()]);
}

function find_user(PDO $db, string $column, $value): ?array
{
    $st = $db->prepare("SELECT * FROM users WHERE $column = ?");
    $st->execute([$value]);
    return $st->fetch() ?: null;
}

function valid_password($p): bool
{
    return is_string($p) && strlen($p) >= 8 && strlen($p) <= 200;
}

/** Verifies a Google Identity Services ID token via Google's tokeninfo endpoint. */
function verify_google(string $credential): ?array
{
    $clientId = config()['google_client_id'] ?? '';
    if ($clientId === '' || !preg_match('/^[A-Za-z0-9._-]+$/', $credential)) {
        return null;
    }
    $url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($credential);
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10]);
    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($status !== 200 || !is_string($body)) {
        return null;
    }
    $t = json_decode($body, true);
    $ok = is_array($t)
        && ($t['aud'] ?? '') === $clientId
        && in_array($t['iss'] ?? '', ['accounts.google.com', 'https://accounts.google.com'], true)
        && (int) ($t['exp'] ?? 0) > time()
        && ($t['email_verified'] ?? '') === 'true'
        && !empty($t['sub']) && !empty($t['email']);
    return $ok ? $t : null;
}

switch ($action) {
    case 'me':
        $user = current_user($db);
        reply(['user' => $user ? user_view($user) : null]);

    case 'signup':
        $name = clean_text($in['name'] ?? '', 60);
        $email = clean_email($in['email'] ?? '');
        $password = $in['password'] ?? '';
        if ($name === '') fail('Please enter your name');
        if ($email === '') fail('Please enter a valid email');
        if (!valid_password($password)) fail('Password must be at least 8 characters');
        if (find_user($db, 'email', $email)) fail('An account with this email already exists. Sign in instead.', 409);
        $db->prepare('INSERT INTO users (email, name, password_hash, currency, created_at) VALUES (?, ?, ?, ?, ?)')
            ->execute([$email, $name, password_hash($password, PASSWORD_DEFAULT), clean_currency($in['currency'] ?? '') ?: 'INR', time()]);
        $id = (int) $db->lastInsertId();
        start_session($db, $id);
        reply(['user' => user_view(find_user($db, 'id', $id))]);

    case 'login':
        $email = clean_email($in['email'] ?? '');
        $password = (string) ($in['password'] ?? '');
        if (too_many_attempts($db, $email)) fail('Too many attempts. Try again in 15 minutes.', 429);
        $user = $email ? find_user($db, 'email', $email) : null;
        if (!$user || $user['password_hash'] === null || !password_verify($password, $user['password_hash'])) {
            record_failure($db, $email);
            if ($user && $user['password_hash'] === null) fail('This account uses Google sign-in. Continue with Google, or reset your password to set one.', 401);
            fail('Wrong email or password', 401);
        }
        if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
            $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
        }
        start_session($db, (int) $user['id']);
        reply(['user' => user_view($user)]);

    case 'google':
        $t = verify_google((string) ($in['credential'] ?? ''));
        if (!$t) fail('Google sign-in failed. Please try again.', 401);
        $email = clean_email($t['email']);
        $user = find_user($db, 'google_sub', $t['sub']) ?? ($email ? find_user($db, 'email', $email) : null);
        if ($user) {
            if ($user['google_sub'] === null) {
                // Linking Google to an email account. If that email was never proven, someone else may have
                // registered it, so drop their password: the Google owner now controls the account.
                $keepPassword = (int) $user['email_verified'] === 1;
                $db->prepare('UPDATE users SET google_sub = ?, email_verified = 1' . ($keepPassword ? '' : ', password_hash = NULL') . ' WHERE id = ?')
                    ->execute([$t['sub'], $user['id']]);
                if (!$keepPassword) {
                    $db->prepare('DELETE FROM sessions WHERE user_id = ?')->execute([$user['id']]);
                }
            }
            $id = (int) $user['id'];
        } else {
            if ($email === '') fail('Google sign-in failed. Please try again.', 401);
            $name = clean_text($t['name'] ?? '', 60) ?: explode('@', $email)[0];
            $db->prepare('INSERT INTO users (email, name, google_sub, email_verified, currency, created_at) VALUES (?, ?, ?, 1, ?, ?)')
                ->execute([$email, $name, $t['sub'], 'INR', time()]);
            $id = (int) $db->lastInsertId();
        }
        start_session($db, $id);
        reply(['user' => user_view(find_user($db, 'id', $id))]);

    case 'logout':
        end_session($db);
        reply(['ok' => true]);

    case 'forgot':
        $email = clean_email($in['email'] ?? '');
        $returnTo = (string) ($in['returnTo'] ?? '/');
        if (!preg_match('#^/([a-z0-9-]+/)?$#', $returnTo)) $returnTo = '/';
        if (too_many_attempts($db, $email)) fail('Too many attempts. Try again in 15 minutes.', 429);
        record_failure($db, $email); // counts toward the limit so this can't be used to spam inboxes
        $user = $email ? find_user($db, 'email', $email) : null;
        if ($user) {
            $token = bin2hex(random_bytes(32));
            $db->prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?')->execute([$user['id'], time()]);
            $db->prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
                ->execute([hash('sha256', $token), $user['id'], time() + RESET_TTL]);
            $c = config();
            $link = rtrim($c['site_url'], '/') . $returnTo . 'reset?token=' . $token;
            $body = "Hi {$user['name']},\r\n\r\nUse this link to set a new password (valid for 1 hour):\r\n$link\r\n\r\nIf you didn't ask for this, you can ignore this email.\r\n";
            $headers = "From: Apps by Ranjith <{$c['mail_from']}>\r\nContent-Type: text/plain; charset=utf-8";
            @mail($user['email'], 'Reset your password', $body, $headers, '-f' . $c['mail_from']);
        }
        reply(['ok' => true]); // same answer either way, so emails can't be probed

    case 'reset':
        $token = (string) ($in['token'] ?? '');
        $password = $in['password'] ?? '';
        if (!valid_password($password)) fail('Password must be at least 8 characters');
        $st = $db->prepare('SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > ?');
        $st->execute([hash('sha256', $token), time()]);
        $userId = $st->fetchColumn();
        if (!$userId) fail('This reset link has expired. Ask for a new one.', 410);
        $db->prepare('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $userId]);
        $db->prepare('DELETE FROM password_resets WHERE user_id = ?')->execute([$userId]);
        $db->prepare('DELETE FROM sessions WHERE user_id = ?')->execute([$userId]);
        start_session($db, (int) $userId);
        reply(['user' => user_view(find_user($db, 'id', (int) $userId))]);

    case 'profile':
        $user = require_user($db);
        $name = clean_text($in['name'] ?? $user['name'], 60);
        $upi = clean_upi($in['upi'] ?? ($user['upi'] ?? ''));
        $currency = clean_currency($in['currency'] ?? $user['currency']);
        if ($name === '') fail('Please enter your name');
        if ($upi === null) fail('That UPI ID doesn\'t look right (example: name@okaxis)');
        if ($currency === '') fail('Unknown currency');
        $db->prepare('UPDATE users SET name = ?, upi = ?, currency = ? WHERE id = ?')
            ->execute([$name, $upi === '' ? null : $upi, $currency, $user['id']]);
        reply(['user' => user_view(find_user($db, 'id', (int) $user['id']))]);

    case 'password':
        $user = require_user($db);
        $password = $in['password'] ?? '';
        if ($user['password_hash'] !== null && !password_verify((string) ($in['current'] ?? ''), $user['password_hash'])) {
            fail('Current password is wrong', 401);
        }
        if (!valid_password($password)) fail('Password must be at least 8 characters');
        $db->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
        reply(['ok' => true]);

    case 'delete_account':
        $user = require_user($db);
        if (($in['confirm'] ?? '') !== 'DELETE') fail('Type DELETE to confirm');
        if ($user['password_hash'] !== null && !password_verify((string) ($in['password'] ?? ''), $user['password_hash'])) {
            fail('Password is wrong', 401);
        }
        $db->beginTransaction();
        foreach (account_delete_hooks() as $hook) {
            $hook($db, $user); // each app detaches or removes its own data first
        }
        $db->prepare('DELETE FROM login_attempts WHERE email = ?')->execute([$user['email']]);
        $db->prepare('DELETE FROM users WHERE id = ?')->execute([$user['id']]); // sessions + resets cascade
        $db->commit();
        set_session_cookie('', time() - 3600);
        reply(['ok' => true]);

    default:
        fail('Unknown action');
}

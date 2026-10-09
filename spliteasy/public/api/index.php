<?php
/**
 * SplitEasy API: groups, members (real users or name-only guests), expenses with
 * multiple payers, payments and an activity log. Balances and settle-up plans are
 * computed in the browser (src/lib/money.js) from the group state returned here.
 *
 * dev/mockApi.js mirrors this file for local development — keep the two in sync,
 * including `allocate`, which must match src/lib/money.js exactly.
 *
 * POST JSON { action, ... } with header X-Requested-With: fetch. Requires sign-in
 * (shared session from /api/auth.php).
 */
declare(strict_types=1);

require __DIR__ . '/../../api/lib/bootstrap.php';

const MAX_AMOUNT = 100000000000;
const SPLIT_TYPES = ['equal', 'exact', 'shares', 'percent'];
const CATEGORIES = ['food', 'travel', 'stay', 'shopping', 'fun', 'bills', 'other'];
const ACTIVITY_LIMIT = 100;

const SPLITEASY_SCHEMA = [
    'CREATE TABLE IF NOT EXISTS se_groups (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(60) NOT NULL,
        emoji VARCHAR(16) NOT NULL,
        currency CHAR(3) NOT NULL,
        rates TEXT NOT NULL,
        invite_token CHAR(32) NOT NULL UNIQUE,
        owner_id INT UNSIGNED NOT NULL,
        version INT UNSIGNED NOT NULL DEFAULT 1,
        seq INT UNSIGNED NOT NULL DEFAULT 0,
        created_at INT NOT NULL,
        updated_at INT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS se_members (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        group_id INT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NULL,
        name VARCHAR(60) NOT NULL,
        upi VARCHAR(100) NULL,
        removed TINYINT(1) NOT NULL DEFAULT 0,
        created_at INT NOT NULL,
        UNIQUE KEY (group_id, user_id),
        FOREIGN KEY (group_id) REFERENCES se_groups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS se_expenses (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        group_id INT UNSIGNED NOT NULL,
        description VARCHAR(80) NOT NULL,
        currency CHAR(3) NOT NULL,
        amount BIGINT NOT NULL,
        spent_on DATE NOT NULL,
        category VARCHAR(20) NOT NULL DEFAULT \'\',
        split_type VARCHAR(8) NOT NULL,
        seq INT UNSIGNED NOT NULL,
        version INT UNSIGNED NOT NULL DEFAULT 1,
        created_by INT UNSIGNED NOT NULL,
        updated_by INT UNSIGNED NOT NULL,
        created_at INT NOT NULL,
        updated_at INT NOT NULL,
        deleted TINYINT(1) NOT NULL DEFAULT 0,
        INDEX (group_id, deleted),
        FOREIGN KEY (group_id) REFERENCES se_groups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS se_expense_payers (
        expense_id INT UNSIGNED NOT NULL,
        member_id INT UNSIGNED NOT NULL,
        amount BIGINT NOT NULL,
        PRIMARY KEY (expense_id, member_id),
        FOREIGN KEY (expense_id) REFERENCES se_expenses(id) ON DELETE CASCADE
    ) ENGINE=InnoDB',
    'CREATE TABLE IF NOT EXISTS se_expense_shares (
        expense_id INT UNSIGNED NOT NULL,
        member_id INT UNSIGNED NOT NULL,
        amount BIGINT NOT NULL,
        weight BIGINT NOT NULL,
        PRIMARY KEY (expense_id, member_id),
        FOREIGN KEY (expense_id) REFERENCES se_expenses(id) ON DELETE CASCADE
    ) ENGINE=InnoDB',
    'CREATE TABLE IF NOT EXISTS se_payments (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        group_id INT UNSIGNED NOT NULL,
        from_member INT UNSIGNED NOT NULL,
        to_member INT UNSIGNED NOT NULL,
        currency CHAR(3) NOT NULL,
        amount BIGINT NOT NULL,
        paid_on DATE NOT NULL,
        note VARCHAR(80) NOT NULL DEFAULT \'\',
        created_by INT UNSIGNED NOT NULL,
        created_at INT NOT NULL,
        deleted TINYINT(1) NOT NULL DEFAULT 0,
        INDEX (group_id, deleted),
        FOREIGN KEY (group_id) REFERENCES se_groups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
    'CREATE TABLE IF NOT EXISTS se_activity (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        group_id INT UNSIGNED NOT NULL,
        member_id INT UNSIGNED NOT NULL,
        data TEXT NOT NULL,
        at INT NOT NULL,
        INDEX (group_id, id),
        FOREIGN KEY (group_id) REFERENCES se_groups(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4',
];

$in = input();
$db = db();
migrate($db, 'spliteasy', SPLITEASY_SCHEMA);
$user = require_user($db);
$uid = (int) $user['id'];
$action = (string) ($in['action'] ?? '');

// ---------- helpers ----------

/** Same algorithm as allocate() in src/lib/money.js. */
function allocate(int $total, string $type, array $split, int $seq): array
{
    if (!in_array($type, SPLIT_TYPES, true)) fail('Unknown split type');
    if (!$split) fail('Pick at least one person to split with');
    $rows = [];
    foreach ($split as $r) {
        $w = $type === 'equal' ? 1 : $r['w'];
        if (!is_int($w) || $w < 0) fail('Split values must be whole, positive numbers');
        if ($type === 'shares' && $w > 1000) fail('Shares can be at most 1000 each');
        $rows[] = ['m' => $r['m'], 'w' => $w];
    }
    $sum = array_sum(array_column($rows, 'w'));
    if ($type === 'exact') {
        if ($sum !== $total) fail('Exact amounts must add up to the total');
        return array_map(fn ($r) => $r + ['a' => $r['w']], $rows);
    }
    if ($type === 'percent' && $sum !== 10000) fail('Percentages must add up to 100%');
    if ($sum <= 0) fail('Split values must add up to more than zero');
    $n = count($rows);
    $parts = [];
    foreach ($rows as $i => $r) {
        $parts[] = $r + [
            'a' => intdiv($total * $r['w'], $sum),
            'frac' => ($total * $r['w']) % $sum,
            'rot' => ((($i - $seq) % $n) + $n) % $n,
        ];
    }
    $rem = $total - array_sum(array_column($parts, 'a'));
    $order = array_keys(array_filter($parts, fn ($p) => $p['w'] > 0));
    usort($order, fn ($x, $y) => ($parts[$y]['frac'] <=> $parts[$x]['frac']) ?: ($parts[$x]['rot'] <=> $parts[$y]['rot']));
    for ($k = 0; $rem > 0; $k = ($k + 1) % count($order), $rem--) {
        $parts[$order[$k]]['a']++;
    }
    return array_map(fn ($p) => ['m' => $p['m'], 'w' => $p['w'], 'a' => $p['a']], $parts);
}

function valid_date($d): string
{
    $d = (string) $d;
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $d, $m) || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
        fail('Please pick a valid date');
    }
    return $d;
}

function valid_amount($a): int
{
    if (!is_int($a) || $a <= 0 || $a > MAX_AMOUNT) fail('Please enter a valid amount');
    return $a;
}

function valid_emoji($e): string
{
    $e = trim((string) $e);
    return $e !== '' && mb_strlen($e) <= 4 && strlen($e) <= 16 ? $e : '👥';
}

/** The caller's membership row in a group (locks the group row when $lock), or 404. */
function membership(PDO $db, int $groupId, int $uid, bool $lock = false): array
{
    $st = $db->prepare('SELECT * FROM se_groups WHERE id = ?' . ($lock ? ' FOR UPDATE' : ''));
    $st->execute([$groupId]);
    $group = $st->fetch();
    $st = $db->prepare('SELECT id FROM se_members WHERE group_id = ? AND user_id = ? AND removed = 0');
    $st->execute([$groupId, $uid]);
    $memberId = $st->fetchColumn();
    if (!$group || !$memberId) fail('Group not found', 404);
    return [$group, (int) $memberId];
}

/** Member ids of a group (including removed ones, which old expenses may reference). */
function member_ids(PDO $db, int $groupId, bool $activeOnly): array
{
    $st = $db->prepare('SELECT id FROM se_members WHERE group_id = ?' . ($activeOnly ? ' AND removed = 0' : ''));
    $st->execute([$groupId]);
    return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
}

function bump(PDO $db, int $groupId): void
{
    $db->prepare('UPDATE se_groups SET version = version + 1, updated_at = ? WHERE id = ?')->execute([time(), $groupId]);
}

function log_activity(PDO $db, int $groupId, int $memberId, array $data): void
{
    $db->prepare('INSERT INTO se_activity (group_id, member_id, data, at) VALUES (?, ?, ?, ?)')
        ->execute([$groupId, $memberId, json_encode($data, JSON_UNESCAPED_UNICODE), time()]);
}

/** Net balance per currency for one member: positive = gets back. */
function member_net(PDO $db, int $groupId, int $memberId): array
{
    $st = $db->prepare('SELECT currency, SUM(v) AS net FROM (
        SELECT e.currency, p.amount AS v FROM se_expense_payers p JOIN se_expenses e ON e.id = p.expense_id
            WHERE e.group_id = ? AND e.deleted = 0 AND p.member_id = ?
        UNION ALL
        SELECT e.currency, -s.amount FROM se_expense_shares s JOIN se_expenses e ON e.id = s.expense_id
            WHERE e.group_id = ? AND e.deleted = 0 AND s.member_id = ?
        UNION ALL
        SELECT currency, amount FROM se_payments WHERE group_id = ? AND deleted = 0 AND from_member = ?
        UNION ALL
        SELECT currency, -amount FROM se_payments WHERE group_id = ? AND deleted = 0 AND to_member = ?
    ) t GROUP BY currency HAVING net <> 0');
    $st->execute([$groupId, $memberId, $groupId, $memberId, $groupId, $memberId, $groupId, $memberId]);
    $out = [];
    foreach ($st->fetchAll() as $r) {
        $out[$r['currency']] = (int) $r['net'];
    }
    return $out;
}

function group_state(PDO $db, array $group, int $meId, int $uid): array
{
    $gid = (int) $group['id'];

    $st = $db->prepare('SELECT m.id, m.user_id, m.removed, COALESCE(u.name, m.name) AS name, COALESCE(u.upi, m.upi) AS upi
        FROM se_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.id');
    $st->execute([$gid]);
    $members = array_map(fn ($m) => [
        'id' => (int) $m['id'],
        'name' => $m['name'],
        'upi' => $m['upi'] ?? '',
        'linked' => $m['user_id'] !== null,
        'removed' => (bool) $m['removed'],
        'isMe' => (int) $m['id'] === $meId,
    ], $st->fetchAll());

    $st = $db->prepare('SELECT * FROM se_expenses WHERE group_id = ? AND deleted = 0 ORDER BY spent_on DESC, id DESC');
    $st->execute([$gid]);
    $expenses = [];
    foreach ($st->fetchAll() as $e) {
        $expenses[(int) $e['id']] = [
            'id' => (int) $e['id'],
            'desc' => $e['description'],
            'currency' => $e['currency'],
            'amount' => (int) $e['amount'],
            'date' => $e['spent_on'],
            'category' => $e['category'],
            'splitType' => $e['split_type'],
            'seq' => (int) $e['seq'],
            'version' => (int) $e['version'],
            'createdBy' => (int) $e['created_by'],
            'updatedBy' => (int) $e['updated_by'],
            'createdAt' => (int) $e['created_at'],
            'updatedAt' => (int) $e['updated_at'],
            'payers' => [],
            'shares' => [],
        ];
    }
    if ($expenses) {
        $ids = implode(',', array_keys($expenses)); // integers from our own table
        foreach ($db->query("SELECT * FROM se_expense_payers WHERE expense_id IN ($ids) ORDER BY member_id") as $p) {
            $expenses[(int) $p['expense_id']]['payers'][] = ['m' => (int) $p['member_id'], 'a' => (int) $p['amount']];
        }
        foreach ($db->query("SELECT * FROM se_expense_shares WHERE expense_id IN ($ids) ORDER BY member_id") as $s) {
            $expenses[(int) $s['expense_id']]['shares'][] = ['m' => (int) $s['member_id'], 'a' => (int) $s['amount'], 'w' => (int) $s['weight']];
        }
    }

    $st = $db->prepare('SELECT * FROM se_payments WHERE group_id = ? AND deleted = 0 ORDER BY paid_on DESC, id DESC');
    $st->execute([$gid]);
    $payments = array_map(fn ($p) => [
        'id' => (int) $p['id'],
        'from' => (int) $p['from_member'],
        'to' => (int) $p['to_member'],
        'currency' => $p['currency'],
        'amount' => (int) $p['amount'],
        'date' => $p['paid_on'],
        'note' => $p['note'],
        'createdBy' => (int) $p['created_by'],
        'createdAt' => (int) $p['created_at'],
    ], $st->fetchAll());

    $st = $db->prepare('SELECT * FROM se_activity WHERE group_id = ? ORDER BY id DESC LIMIT ' . ACTIVITY_LIMIT);
    $st->execute([$gid]);
    $activity = array_map(fn ($a) => [
        'id' => (int) $a['id'],
        'by' => (int) $a['member_id'],
        'at' => (int) $a['at'],
    ] + json_decode($a['data'], true), $st->fetchAll());

    return [
        'group' => [
            'id' => $gid,
            'name' => $group['name'],
            'emoji' => $group['emoji'],
            'currency' => $group['currency'],
            'rates' => json_decode($group['rates'], true) ?: (object) [],
            'inviteToken' => $group['invite_token'],
            'isOwner' => (int) $group['owner_id'] === $uid,
            'version' => (int) $group['version'],
            'seq' => (int) $group['seq'],
        ],
        'meId' => $meId,
        'members' => $members,
        'expenses' => array_values($expenses),
        'payments' => $payments,
        'activity' => $activity,
    ];
}

/** Validates the payer/split lists of an expense against the group's members. */
function check_people(array $list, string $key, array $memberIds, string $what): array
{
    $seen = [];
    $out = [];
    foreach ($list as $row) {
        $m = $row['m'] ?? null;
        if (!is_int($m) || !in_array($m, $memberIds, true) || isset($seen[$m])) fail("Please check who $what");
        $seen[$m] = true;
        $out[] = ['m' => $m, $key => $row[$key] ?? null];
    }
    return $out;
}

// ---------- actions ----------

switch ($action) {
    case 'groups':
        $st = $db->prepare('SELECT g.id, g.name, g.emoji, g.currency, g.updated_at, m.id AS me,
            (SELECT COUNT(*) FROM se_members x WHERE x.group_id = g.id AND x.removed = 0) AS members
            FROM se_members m JOIN se_groups g ON g.id = m.group_id
            WHERE m.user_id = ? AND m.removed = 0 ORDER BY g.updated_at DESC');
        $st->execute([$uid]);
        $groups = array_map(fn ($g) => [
            'id' => (int) $g['id'],
            'name' => $g['name'],
            'emoji' => $g['emoji'],
            'currency' => $g['currency'],
            'members' => (int) $g['members'],
            'updatedAt' => (int) $g['updated_at'],
            'net' => (object) member_net($db, (int) $g['id'], (int) $g['me']),
        ], $st->fetchAll());
        reply(['groups' => $groups]);

    case 'create_group':
        $name = clean_text($in['name'] ?? '', 60);
        $currency = clean_currency($in['currency'] ?? '') ?: $user['currency'];
        if ($name === '') fail('Please name the group');
        $guests = array_values(array_filter(array_map(fn ($n) => clean_text($n, 60), (array) ($in['guests'] ?? []))));
        if (count($guests) > 50) fail('That\'s a lot of people. Add at most 50 at once.');
        $db->beginTransaction();
        $db->prepare('INSERT INTO se_groups (name, emoji, currency, rates, invite_token, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$name, valid_emoji($in['emoji'] ?? ''), $currency, '{}', bin2hex(random_bytes(16)), $uid, time(), time()]);
        $gid = (int) $db->lastInsertId();
        $add = $db->prepare('INSERT INTO se_members (group_id, user_id, name, created_at) VALUES (?, ?, ?, ?)');
        $add->execute([$gid, $uid, $user['name'], time()]);
        $me = (int) $db->lastInsertId();
        foreach ($guests as $g) {
            $add->execute([$gid, null, $g, time()]);
        }
        log_activity($db, $gid, $me, ['type' => 'group_create', 'name' => $name]);
        $db->commit();
        reply(['groupId' => $gid]);

    case 'group':
        [$group, $me] = membership($db, (int) ($in['id'] ?? 0), $uid);
        if (isset($in['since']) && (int) $in['since'] === (int) $group['version']) {
            reply(['unchanged' => true]);
        }
        reply(group_state($db, $group, $me, $uid));

    case 'update_group':
        $db->beginTransaction();
        [$group, $me] = membership($db, (int) ($in['id'] ?? 0), $uid, true);
        $name = array_key_exists('name', $in) ? clean_text($in['name'], 60) : $group['name'];
        $currency = array_key_exists('currency', $in) ? clean_currency($in['currency']) : $group['currency'];
        if ($name === '') fail('Please name the group');
        if ($currency === '') fail('Unknown currency');
        $rates = json_decode($group['rates'], true) ?: [];
        if (array_key_exists('rates', $in)) {
            $rates = [];
            foreach ((array) $in['rates'] as $cur => $rate) {
                $cur = clean_currency($cur);
                $rate = trim((string) $rate);
                if ($cur === '' || $cur === $currency || $rate === '') continue;
                if (!preg_match('/^\d{1,9}(\.\d{1,8})?$/', $rate) || (float) $rate <= 0) fail("Please check the rate for $cur");
                $rates[$cur] = $rate;
            }
        }
        $db->prepare('UPDATE se_groups SET name = ?, emoji = ?, currency = ?, rates = ? WHERE id = ?')
            ->execute([$name, valid_emoji($in['emoji'] ?? $group['emoji']), $currency, json_encode((object) $rates), $group['id']]);
        log_activity($db, (int) $group['id'], $me, ['type' => 'group_update', 'name' => $name]);
        bump($db, (int) $group['id']);
        $db->commit();
        reply(['ok' => true]);

    case 'delete_group':
        $db->beginTransaction();
        [$group] = membership($db, (int) ($in['id'] ?? 0), $uid, true);
        if ((int) $group['owner_id'] !== $uid) fail('Only the person who created the group can delete it', 403);
        $db->prepare('DELETE FROM se_groups WHERE id = ?')->execute([$group['id']]);
        $db->commit();
        reply(['ok' => true]);

    case 'reset_invite':
        $db->beginTransaction();
        [$group, $me] = membership($db, (int) ($in['id'] ?? 0), $uid, true);
        $db->prepare('UPDATE se_groups SET invite_token = ? WHERE id = ?')->execute([bin2hex(random_bytes(16)), $group['id']]);
        log_activity($db, (int) $group['id'], $me, ['type' => 'invite_reset']);
        bump($db, (int) $group['id']);
        $db->commit();
        reply(['ok' => true]);

    case 'add_member':
        $db->beginTransaction();
        [$group, $me] = membership($db, (int) ($in['groupId'] ?? 0), $uid, true);
        $name = clean_text($in['name'] ?? '', 60);
        $upi = clean_upi($in['upi'] ?? '');
        if ($name === '') fail('Please enter a name');
        if ($upi === null) fail('That UPI ID doesn\'t look right (example: name@okaxis)');
        $db->prepare('INSERT INTO se_members (group_id, name, upi, created_at) VALUES (?, ?, ?, ?)')
            ->execute([$group['id'], $name, $upi === '' ? null : $upi, time()]);
        log_activity($db, (int) $group['id'], $me, ['type' => 'member_add', 'name' => $name]);
        bump($db, (int) $group['id']);
        $db->commit();
        reply(['memberId' => (int) $db->lastInsertId()]);

    case 'update_member':
        $db->beginTransaction();
        [$group, $me] = membership($db, (int) ($in['groupId'] ?? 0), $uid, true);
        $st = $db->prepare('SELECT * FROM se_members WHERE id = ? AND group_id = ?');
        $st->execute([(int) ($in['memberId'] ?? 0), $group['id']]);
        $m = $st->fetch();
        if (!$m) fail('Member not found', 404);
        if ($m['user_id'] !== null) fail('People with an account edit their own name and UPI ID in their profile');
        $name = clean_text($in['name'] ?? $m['name'], 60);
        $upi = clean_upi($in['upi'] ?? ($m['upi'] ?? ''));
        if ($name === '') fail('Please enter a name');
        if ($upi === null) fail('That UPI ID doesn\'t look right (example: name@okaxis)');
        $db->prepare('UPDATE se_members SET name = ?, upi = ? WHERE id = ?')->execute([$name, $upi === '' ? null : $upi, $m['id']]);
        bump($db, (int) $group['id']);
        $db->commit();
        reply(['ok' => true]);

    case 'remove_member':
        $db->beginTransaction();
        [$group, $me] = membership($db, (int) ($in['groupId'] ?? 0), $uid, true);
        $st = $db->prepare('SELECT m.*, COALESCE(u.name, m.name) AS display FROM se_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ? AND m.group_id = ? AND m.removed = 0');
        $st->execute([(int) ($in['memberId'] ?? 0), $group['id']]);
        $m = $st->fetch();
        if (!$m) fail('Member not found', 404);
        if ((int) $m['user_id'] === (int) $group['owner_id']) fail('The group creator can\'t be removed');
        if (member_net($db, (int) $group['id'], (int) $m['id'])) fail("{$m['display']} still has an unsettled balance. Settle up first.");
        $db->prepare('UPDATE se_members SET removed = 1 WHERE id = ?')->execute([$m['id']]);
        log_activity($db, (int) $group['id'], $me, ['type' => 'member_remove', 'name' => $m['display']]);
        bump($db, (int) $group['id']);
        $db->commit();
        reply(['ok' => true]);

    case 'save_expense':
        $db->beginTransaction();
        [$group, $me] = membership($db, (int) ($in['groupId'] ?? 0), $uid, true);
        $gid = (int) $group['id'];
        $desc = clean_text($in['desc'] ?? '', 80);
        $currency = clean_currency($in['currency'] ?? '');
        $amount = valid_amount($in['amount'] ?? null);
        $date = valid_date($in['date'] ?? '');
        $category = in_array($in['category'] ?? '', CATEGORIES, true) ? $in['category'] : '';
        $type = (string) ($in['splitType'] ?? '');
        if ($desc === '') fail('Please add a description');
        if ($currency === '') fail('Unknown currency');

        $id = (int) ($in['id'] ?? 0);
        $existing = null;
        if ($id) {
            $st = $db->prepare('SELECT * FROM se_expenses WHERE id = ? AND group_id = ? AND deleted = 0');
            $st->execute([$id, $gid]);
            $existing = $st->fetch();
            if (!$existing) fail('This expense was deleted by someone else', 409);
            if ((int) $existing['version'] !== (int) ($in['version'] ?? 0)) fail('Someone else just changed this expense. Reload to see their changes.', 409);
        }
        // New expenses may only involve current members; edits may keep people who were removed since.
        $allowed = member_ids($db, $gid, !$existing);
        $payers = check_people((array) ($in['payers'] ?? []), 'a', $allowed, 'paid');
        if (!$payers) fail('Please choose who paid');
        foreach ($payers as $p) {
            if (!is_int($p['a']) || $p['a'] <= 0) fail('Each payer needs an amount');
        }
        if (array_sum(array_column($payers, 'a')) !== $amount) fail('What each person paid must add up to the total');
        $split = check_people((array) ($in['split'] ?? []), 'w', $allowed, 'this is split with');
        $seq = $existing ? (int) $existing['seq'] : (int) $group['seq'];
        $shares = allocate($amount, $type, $split, $seq);

        $now = time();
        if ($existing) {
            $db->prepare('UPDATE se_expenses SET description = ?, currency = ?, amount = ?, spent_on = ?, category = ?, split_type = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?')
                ->execute([$desc, $currency, $amount, $date, $category, $type, $me, $now, $id]);
            $db->prepare('DELETE FROM se_expense_payers WHERE expense_id = ?')->execute([$id]);
            $db->prepare('DELETE FROM se_expense_shares WHERE expense_id = ?')->execute([$id]);
        } else {
            $db->prepare('INSERT INTO se_expenses (group_id, description, currency, amount, spent_on, category, split_type, seq, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$gid, $desc, $currency, $amount, $date, $category, $type, $seq, $me, $me, $now, $now]);
            $id = (int) $db->lastInsertId();
            $db->prepare('UPDATE se_groups SET seq = seq + 1 WHERE id = ?')->execute([$gid]);
        }
        $ins = $db->prepare('INSERT INTO se_expense_payers (expense_id, member_id, amount) VALUES (?, ?, ?)');
        foreach ($payers as $p) $ins->execute([$id, $p['m'], $p['a']]);
        $ins = $db->prepare('INSERT INTO se_expense_shares (expense_id, member_id, amount, weight) VALUES (?, ?, ?, ?)');
        foreach ($shares as $s) $ins->execute([$id, $s['m'], $s['a'], $s['w']]);
        log_activity($db, $gid, $me, ['type' => $existing ? 'expense_edit' : 'expense_add', 'desc' => $desc, 'currency' => $currency, 'amount' => $amount]);
        bump($db, $gid);
        $db->commit();
        reply(['expenseId' => $id]);

    case 'delete_expense':
        $db->beginTransaction();
        [$group, $me] = membership($db, (int) ($in['groupId'] ?? 0), $uid, true);
        $st = $db->prepare('SELECT * FROM se_expenses WHERE id = ? AND group_id = ? AND deleted = 0');
        $st->execute([(int) ($in['id'] ?? 0), $group['id']]);
        $e = $st->fetch();
        if (!$e) fail('This expense was already deleted', 409);
        if ((int) $e['version'] !== (int) ($in['version'] ?? 0)) fail('Someone else just changed this expense. Reload to see their changes.', 409);
        $db->prepare('UPDATE se_expenses SET deleted = 1, updated_by = ?, updated_at = ? WHERE id = ?')->execute([$me, time(), $e['id']]);
        log_activity($db, (int) $group['id'], $me, ['type' => 'expense_delete', 'desc' => $e['description'], 'currency' => $e['currency'], 'amount' => (int) $e['amount']]);
        bump($db, (int) $group['id']);
        $db->commit();
        reply(['ok' => true]);

    case 'save_payment':
        $db->beginTransaction();
        [$group, $me] = membership($db, (int) ($in['groupId'] ?? 0), $uid, true);
        $gid = (int) $group['id'];
        $active = member_ids($db, $gid, true);
        $from = $in['from'] ?? null;
        $to = $in['to'] ?? null;
        if (!is_int($from) || !is_int($to) || !in_array($from, $active, true) || !in_array($to, $active, true) || $from === $to) {
            fail('Please choose who paid whom');
        }
        $currency = clean_currency($in['currency'] ?? '');
        if ($currency === '') fail('Unknown currency');
        $amount = valid_amount($in['amount'] ?? null);
        $date = valid_date($in['date'] ?? '');
        $note = clean_text($in['note'] ?? '', 80);
        $db->prepare('INSERT INTO se_payments (group_id, from_member, to_member, currency, amount, paid_on, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$gid, $from, $to, $currency, $amount, $date, $note, $me, time()]);
        $pid = (int) $db->lastInsertId();
        log_activity($db, $gid, $me, ['type' => 'payment_add', 'from' => $from, 'to' => $to, 'currency' => $currency, 'amount' => $amount]);
        bump($db, $gid);
        $db->commit();
        reply(['paymentId' => $pid]);

    case 'delete_payment':
        $db->beginTransaction();
        [$group, $me] = membership($db, (int) ($in['groupId'] ?? 0), $uid, true);
        $st = $db->prepare('SELECT * FROM se_payments WHERE id = ? AND group_id = ? AND deleted = 0');
        $st->execute([(int) ($in['id'] ?? 0), $group['id']]);
        $p = $st->fetch();
        if (!$p) fail('This payment was already deleted', 409);
        $db->prepare('UPDATE se_payments SET deleted = 1 WHERE id = ?')->execute([$p['id']]);
        log_activity($db, (int) $group['id'], $me, ['type' => 'payment_delete', 'from' => (int) $p['from_member'], 'to' => (int) $p['to_member'], 'currency' => $p['currency'], 'amount' => (int) $p['amount']]);
        bump($db, (int) $group['id']);
        $db->commit();
        reply(['ok' => true]);

    case 'invite_info':
        $st = $db->prepare('SELECT * FROM se_groups WHERE invite_token = ?');
        $st->execute([(string) ($in['token'] ?? '')]);
        $group = $st->fetch();
        if (!$group) fail('This invite link is no longer valid. Ask for a new one.', 404);
        $st = $db->prepare('SELECT id FROM se_members WHERE group_id = ? AND user_id = ? AND removed = 0');
        $st->execute([$group['id'], $uid]);
        $already = (bool) $st->fetchColumn();
        $st = $db->prepare('SELECT id, name FROM se_members WHERE group_id = ? AND user_id IS NULL AND removed = 0 ORDER BY name');
        $st->execute([$group['id']]);
        $st2 = $db->prepare('SELECT COUNT(*) FROM se_members WHERE group_id = ? AND removed = 0');
        $st2->execute([$group['id']]);
        reply([
            'group' => ['id' => (int) $group['id'], 'name' => $group['name'], 'emoji' => $group['emoji'], 'members' => (int) $st2->fetchColumn()],
            'alreadyMember' => $already,
            'guests' => array_map(fn ($g) => ['id' => (int) $g['id'], 'name' => $g['name']], $st->fetchAll()),
        ]);

    case 'join':
        $db->beginTransaction();
        $st = $db->prepare('SELECT * FROM se_groups WHERE invite_token = ? FOR UPDATE');
        $st->execute([(string) ($in['token'] ?? '')]);
        $group = $st->fetch();
        if (!$group) fail('This invite link is no longer valid. Ask for a new one.', 404);
        $gid = (int) $group['id'];
        $st = $db->prepare('SELECT id, removed FROM se_members WHERE group_id = ? AND user_id = ?');
        $st->execute([$gid, $uid]);
        $mine = $st->fetch();
        if ($mine && !(int) $mine['removed']) {
            $db->commit();
            reply(['groupId' => $gid]);
        }
        $claim = (int) ($in['claimMemberId'] ?? 0);
        if ($claim) {
            if ($mine) fail('You were in this group before, so you can\'t take over a guest. Join as yourself.');
            $st = $db->prepare('UPDATE se_members SET user_id = ?, upi = NULL WHERE id = ? AND group_id = ? AND user_id IS NULL AND removed = 0');
            $st->execute([$uid, $claim, $gid]);
            if ($st->rowCount() !== 1) fail('Someone else already claimed that name. Pick again.', 409);
            $me = $claim;
        } elseif ($mine) {
            $db->prepare('UPDATE se_members SET removed = 0 WHERE id = ?')->execute([$mine['id']]);
            $me = (int) $mine['id'];
        } else {
            $db->prepare('INSERT INTO se_members (group_id, user_id, name, created_at) VALUES (?, ?, ?, ?)')->execute([$gid, $uid, $user['name'], time()]);
            $me = (int) $db->lastInsertId();
        }
        log_activity($db, $gid, $me, ['type' => 'member_join', 'name' => $user['name']]);
        bump($db, $gid);
        $db->commit();
        reply(['groupId' => $gid]);

    default:
        fail('Unknown action');
}

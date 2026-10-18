<?php
/**
 * Called by /api/auth.php (action delete_account) inside its transaction, before the user row
 * is deleted. dev/mockApi.js mirrors this in `spliteasyDeleteUser` — keep the two in sync.
 *
 * - Groups the user created pass to the earliest-joined other member who has an account;
 *   if nobody else has one, the group is deleted.
 * - Everywhere else the user becomes a name-only guest (UPI ID removed), so the other
 *   members' expenses and balances stay intact.
 */
declare(strict_types=1);

return function (PDO $db, array $user): void {
    if (!$db->query("SHOW TABLES LIKE 'se_members'")->fetchColumn()) {
        return; // SplitEasy never used on this install
    }
    $uid = (int) $user['id'];
    $now = time();

    $st = $db->prepare('SELECT id FROM se_groups WHERE owner_id = ? FOR UPDATE');
    $st->execute([$uid]);
    $heir = $db->prepare('SELECT user_id FROM se_members WHERE group_id = ? AND user_id IS NOT NULL AND user_id <> ? AND removed = 0 ORDER BY id LIMIT 1');
    foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $gid) {
        $heir->execute([$gid, $uid]);
        $next = $heir->fetchColumn();
        if ($next) {
            $db->prepare('UPDATE se_groups SET owner_id = ? WHERE id = ?')->execute([$next, $gid]);
        } else {
            $db->prepare('DELETE FROM se_groups WHERE id = ?')->execute([$gid]); // everything else cascades
        }
    }

    $st = $db->prepare('SELECT id, group_id FROM se_members WHERE user_id = ?');
    $st->execute([$uid]);
    $memberships = $st->fetchAll();
    $db->prepare('UPDATE se_members SET user_id = NULL, name = ?, upi = NULL WHERE user_id = ?')->execute([$user['name'], $uid]);
    $log = $db->prepare('INSERT INTO se_activity (group_id, member_id, data, at) VALUES (?, ?, ?, ?)');
    $bump = $db->prepare('UPDATE se_groups SET version = version + 1, updated_at = ? WHERE id = ?');
    foreach ($memberships as $m) {
        $log->execute([$m['group_id'], $m['id'], json_encode(['type' => 'account_deleted', 'name' => $user['name']], JSON_UNESCAPED_UNICODE), $now]);
        $bump->execute([$now, $m['group_id']]);
    }
};

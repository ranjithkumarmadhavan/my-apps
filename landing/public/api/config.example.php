<?php
// Copy to config.php on the server (never commit config.php) and fill in the details.
return [
    'db_host' => 'localhost',
    'db_name' => 'u000000000_apps',
    'db_user' => 'u000000000_apps',
    'db_pass' => 'change-me',
    // OAuth 2.0 Client ID (Web) from Google Cloud Console. Leave empty to hide "Continue with Google".
    'google_client_id' => '',
    // A real mailbox on the domain; Hostinger only sends mail() from existing mailboxes.
    'mail_from' => 'noreply@ranjithkumarmadhavan.com',
    'site_url' => 'https://apps.ranjithkumarmadhavan.com',
];

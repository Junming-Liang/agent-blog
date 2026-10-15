<?php
// Read content tables directly; do not bootstrap WordPress plugins or run cron.
mysqli_report(MYSQLI_REPORT_OFF);
function config_literal($token) {
    if (!is_array($token) || $token[0] !== T_CONSTANT_ENCAPSED_STRING) {
        throw new RuntimeException('Database settings must be string literals.');
    }
    return eval('return ' . $token[1] . ';');
}
$root = $argv[1] ?? '';
if (!is_file($root . '/wp-config.php')) throw new RuntimeException('Pass the WordPress installation directory.');
$tokens = array_values(array_filter(token_get_all(file_get_contents($root . '/wp-config.php')),
    fn($t) => !is_array($t) || !in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT, T_OPEN_TAG])));
$settings = []; $prefix = null;
foreach ($tokens as $i => $token) {
    if (is_array($token) && $token[0] === T_STRING && strtolower($token[1]) === 'define' && ($tokens[$i + 1] ?? null) === '(') {
        $name = config_literal($tokens[$i + 2]);
        if (in_array($name, ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'])) $settings[$name] = config_literal($tokens[$i + 4]);
    }
    if (is_array($token) && $token[0] === T_VARIABLE && $token[1] === '$table_prefix' && ($tokens[$i + 1] ?? null) === '=') $prefix = config_literal($tokens[$i + 2]);
}
if (count($settings) !== 4 || !preg_match('/^[a-zA-Z0-9_]+$/', $prefix ?? '')) throw new RuntimeException('Unsupported WordPress configuration.');
$db = @new mysqli($settings['DB_HOST'], $settings['DB_USER'], $settings['DB_PASSWORD'], $settings['DB_NAME']);
if ($db->connect_errno) throw new RuntimeException('Cannot connect to the WordPress database.');
$db->set_charset('utf8mb4');
function select_rows($db, $sql) {
    if (!str_starts_with($sql, 'SELECT ')) throw new RuntimeException('Only SELECT is permitted.');
    $result = $db->query($sql);
    if (!$result) throw new RuntimeException('Content query failed.');
    return $result->fetch_all(MYSQLI_ASSOC);
}
if (!$db->query('START TRANSACTION WITH CONSISTENT SNAPSHOT')) throw new RuntimeException('Cannot start content snapshot.');
try {
    $options = [];
    foreach (select_rows($db, "SELECT option_name, option_value FROM {$prefix}options WHERE option_name IN ('blogname','blogdescription','home','siteurl','timezone_string','permalink_structure')") as $row) $options[$row['option_name']] = $row['option_value'];
    $data = [
        'version' => 1, 'exportedAt' => gmdate('c'), 'options' => $options,
        'posts' => select_rows($db, "SELECT p.*, u.display_name AS author FROM {$prefix}posts p LEFT JOIN {$prefix}users u ON p.post_author=u.ID ORDER BY p.ID"),
        'postmeta' => select_rows($db, "SELECT * FROM {$prefix}postmeta ORDER BY meta_id"),
        'terms' => select_rows($db, "SELECT r.object_id,t.name,t.slug,tt.taxonomy,tt.description FROM {$prefix}term_relationships r JOIN {$prefix}term_taxonomy tt ON r.term_taxonomy_id=tt.term_taxonomy_id JOIN {$prefix}terms t ON tt.term_id=t.term_id ORDER BY r.object_id,tt.term_taxonomy_id"),
        'comments' => select_rows($db, "SELECT * FROM {$prefix}comments ORDER BY comment_ID"),
        'links' => select_rows($db, "SELECT * FROM {$prefix}links ORDER BY link_id")
    ];
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
} finally {
    $db->rollback();
    $db->close();
}

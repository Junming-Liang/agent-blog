<?php
// This adapter is used only behind TLS and forwards authenticated editor traffic.
function respond_error($status, $message) {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => ['code' => 'EDITOR_GATEWAY', 'message' => $message]]);
    exit;
}
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header("Content-Security-Policy: frame-ancestors 'self'");
$uri = $_SERVER['REQUEST_URI'] ?? '';
$path = parse_url($uri, PHP_URL_PATH);
$rebase = ($_SERVER['AGENT_BLOG_WORDPRESS_REBASE'] ?? '') === '1';
$login = $rebase && $path === '/wp-login.php';
if (!is_string($path) || (!preg_match('#^/(?:__editor(?:/|$)|_assets/)#', $path) && !$login)) respond_error(404, 'Not found.');
$origin = $_SERVER['AGENT_BLOG_ORIGIN'] ?? '';
$upstream = $_SERVER['AGENT_BLOG_UPSTREAM'] ?? '';
$root = $_SERVER['AGENT_BLOG_WORDPRESS_ROOT'] ?? '';
if (!preg_match('#^https://[a-z0-9.-]+(?::[0-9]+)?$#', $origin) || !preg_match('#^http://127\.0\.0\.1:[0-9]+$#', $upstream) || !is_file($root . '/wp-load.php')) respond_error(503, 'Editor gateway is not configured.');
$method = $_SERVER['REQUEST_METHOD'];
if (isset($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== $origin) respond_error(403, 'Origin rejected.');
if (!in_array($method, ['GET', 'HEAD']) && ($_SERVER['HTTP_ORIGIN'] ?? '') !== $origin) respond_error(403, 'Same-origin requests are required.');
define('DISABLE_WP_CRON', true);
if ($rebase) {
    // Request-local aliases keep login URLs and cookies on this origin without changing database options.
    define('WP_HOME', $origin);
    define('WP_SITEURL', $origin);
}
if ($login) {
    // WordPress rebuilds REQUEST from GET and POST during bootstrap.
    if (!isset($_REQUEST['redirect_to'])) $_GET['redirect_to'] = $_REQUEST['redirect_to'] = $origin . '/__editor/';
    require $root . '/wp-login.php';
    exit;
}
require_once $root . '/wp-load.php';
if (!is_user_logged_in()) {
    if ($method === 'GET' && in_array($path, ['/__editor', '/__editor/'])) {
        wp_safe_redirect(wp_login_url($origin . '/__editor/'));
        exit;
    }
    respond_error(401, 'Sign in with your WordPress account.');
}
// The editor and CLI can access private posts and publish content; require administrator authority.
if (!current_user_can('manage_options')) respond_error(403, 'Administrator access is required.');
if (!in_array($method, ['GET', 'HEAD', 'POST', 'PUT'])) respond_error(405, 'Method not allowed.');
$body = file_get_contents('php://input', false, null, 0, 2 * 1024 * 1024 + 1);
if ($body === false || strlen($body) > 2 * 1024 * 1024) respond_error(413, 'Request exceeds 2 MiB.');
$curl = curl_init($upstream . $uri);
curl_setopt_array($curl, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_PROXY => '',
    CURLOPT_CONNECTTIMEOUT => 3,
    CURLOPT_TIMEOUT => 30,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTP,
    CURLOPT_HTTPHEADER => ['Content-Type: ' . ($_SERVER['CONTENT_TYPE'] ?? 'application/json'), 'Origin: ' . $upstream],
    CURLOPT_POSTFIELDS => $body
]);
$result = curl_exec($curl);
$status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
$type = curl_getinfo($curl, CURLINFO_CONTENT_TYPE);
curl_close($curl);
if ($result === false || !$status) respond_error(502, 'The editing service is unavailable.');
http_response_code($status);
header('Content-Type: ' . ($type ?: 'application/octet-stream'));
if ($method !== 'HEAD') echo $result;

"""Utility helpers for authentication, security, auditing, rate limiting & push notifications.

This module centralizes cross-cutting backend concerns so view functions remain
focused on business logic and raw SQL composition. Key areas:

Authentication & CSRF:
        - Token-based auth (X-Auth-Token) with per-token associated CSRF token.
        - Header-enforced CSRF validation for state-changing requests (POST/PUT/DELETE/PATCH).
        - DEV_OPEN (settings flag) can relax enforcement in local development while still
            allowing endpoints to operate without credentials for faster iteration.

Password Handling:
        - Uses PBKDF2-HMAC-SHA256 (310k iterations) with random 16-byte salt for new hashes.
        - Also supports verifying legacy Django-style `pbkdf2_sha256$...` formatted hashes
            (in case imported user records exist) for seamless auth.

Rate Limiting (lightweight, in-memory):
        - Sliding window counters using deque per key; not persistent (acceptable for this
            demo scope). Prevents brute force on sensitive endpoints.

Audit Logging & Notifications:
        - Writes lightweight audit log rows for requests (best-effort / fire-and-forget).
        - Inserts notifications and pushes them over Channels groups to connected clients.

Push Optimizations:
        - `_push` debounces high-frequency event types (example: "dm_unread_total") so the
            UI isn't flooded.

Guiding Principles:
        - Fail closed for auth/CSRF (deny on missing/invalid tokens).
        - Fail open (ignore silently) for non-critical telemetry like audit & push to avoid
            impacting core API reliability.
"""

from django.http import JsonResponse, HttpRequest
from django.views.decorators.csrf import csrf_exempt
from functools import wraps, partial
from django.utils import timezone
from django.conf import settings
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
import json, secrets, base64, hmac, time, os
from hashlib import pbkdf2_hmac
from collections import defaultdict, deque
from .db import query, execute
from math import ceil
from django.db import connection as _conn


def _now_expr():
    """Return SQL expression for current timestamp portable across sqlite/MySQL.

    We keep this logic so raw SQL queries can embed NOW() / datetime('now') safely
    without branching at each call site.
    """
    return "datetime('now')" if 'sqlite' in str(_conn.settings_dict.get('ENGINE','')) else 'NOW()'


def _now_plus(days=0, minutes=0):
    """Return SQL expression for now + offset (days or minutes).

    Only a few endpoints might require token or temporary object expiry computations.
    This helper keeps SQL consistent across engines; currently supports sqlite/MySQL.
    """
    if 'sqlite' in str(_conn.settings_dict.get('ENGINE','')):
        parts = []
        if days:
            parts.append(f"+{days} day")
        if minutes:
            parts.append(f"+{minutes} minute")
        inner = ",".join(repr(p) for p in parts) if parts else ''
        return f"datetime('now'{(','+inner) if inner else ''})"
    else:
        return f"DATE_ADD(NOW(), INTERVAL {days} DAY)" if days else 'NOW()'


_RL_BUCKETS = defaultdict(deque)
_PUSH_LAST = {}


def _rate_limited(key: str, limit: int, window_seconds: int):
    """Return (True, retry_after_seconds) if key exceeded its rate limit.

    Simple sliding window: we store timestamps in a deque and trim stale entries.
    Adequate for low concurrency + single-process dev deployment. For production
    you'd move to Redis or a distributed token bucket.
    """
    now = time.time()
    dq = _RL_BUCKETS[key]
    cutoff = now - window_seconds
    while dq and dq[0] < cutoff:
        dq.popleft()
    if len(dq) >= limit:
        return True, int(dq[0] + window_seconds - now)
    dq.append(now)
    return False, None


def _limit_str(val: str, max_len: int):
    """Return truncated string (or empty string if not a str)."""
    if not isinstance(val, str):
        return ''
    if len(val) > max_len:
        return val[:max_len]
    return val


def _hash_password(pw: str) -> str:
    """Generate PBKDF2-SHA256 password hash with random 16B salt.

    Format: base64(salt):base64(derived_key)
    Iterations: 310000 (matches modern Django default scale range for strength)
    """
    salt = secrets.token_bytes(16)
    dk = pbkdf2_hmac('sha256', pw.encode(), salt, 310000)
    return base64.b64encode(salt).decode()+":"+base64.b64encode(dk).decode()


def _verify_password(pw: str, stored: str) -> bool:
    """Validate a password against stored hash.

    Supports two formats:
      1. Django legacy style: 'pbkdf2_sha256$iterations$salt$hash'
         - hash may be hex or base64 depending on historical export
      2. Local format: base64(salt):base64(derived_key)
    """
    try:
        if stored.startswith('pbkdf2_sha256$') and stored.count('$') == 3:
            _algo, iter_s, salt_part, hash_part = stored.split('$')
            iterations = int(iter_s)
            dk_raw = pbkdf2_hmac('sha256', pw.encode(), salt_part.encode(), iterations)
            # Determine representation (hex vs base64)
            is_hex = all(c in '0123456789abcdef' for c in hash_part.lower()) and len(hash_part) % 2 == 0
            if is_hex:
                dk_test = dk_raw.hex()
                return hmac.compare_digest(hash_part, dk_test)
            else:
                import base64 as _b64
                dk_b64 = _b64.b64encode(dk_raw).decode().strip()
                return hmac.compare_digest(hash_part, dk_b64)
        if ':' in stored:
            salt_b64, dk_b64 = stored.split(':')
            salt = base64.b64decode(salt_b64)
            dk_stored = base64.b64decode(dk_b64)
            dk_test = pbkdf2_hmac('sha256', pw.encode(), salt, 310000)
            return hmac.compare_digest(dk_stored, dk_test)
        return False
    except Exception:
        return False


def _require_method(request, methods):
    """Return JSON error response if request method not in allowed list."""
    if request.method not in methods:
        return JsonResponse({'error': 'method_not_allowed'}, status=405)
    return None


def _auth_user(request):
    """Return user record (with attached token CSRF) for valid auth token or None."""
    token = request.headers.get('X-Auth-Token') or request.COOKIES.get('auth_token')
    if not token:
        return None
    now_expr = _now_expr()
    user = query(f"SELECT u.*, t.csrf_token at_csrf FROM users u JOIN auth_tokens t ON t.user_id=u.id WHERE t.token=%s AND t.expires_at>{now_expr}", [token])
    return user


def _check_csrf(request, user):
    """Validate header CSRF token against one issued with auth token."""
    if request.method in ('POST','PUT','DELETE','PATCH'):
        sent = request.headers.get('X-CSRF-Token')
        if not sent or not user.get('at_csrf') or not hmac.compare_digest(sent, user['at_csrf']):
            return JsonResponse({'error':'csrf_failed'}, status=403)
    return None


def _audit(request: HttpRequest, user_id, status_code, meta=None):
    """Best-effort record of request outcome for diagnostics/compliance."""
    try:
        execute("INSERT INTO audit_logs(user_id,path,method,status_code,meta) VALUES(%s,%s,%s,%s,%s)",[user_id, request.path[:255], request.method, status_code, json.dumps(meta) if meta else None])
    except Exception:
        pass


def _audit_safe(request, user_id, meta):
    """Convenience wrapper to log a success (200) without raising failures."""
    try:
        _audit(request, user_id, 200, meta)
    except Exception:
        pass


def _notify(user_id: int, ntype: str, payload: dict):
    """Persist notification then push real-time event to user group (best-effort)."""
    try:
        execute("INSERT INTO notifications(user_id,type,payload) VALUES(%s,%s,%s)",[user_id, ntype, json.dumps(payload)])
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(f"notif_{user_id}", {'type': 'notify','data': {'type': ntype, 'payload': payload}})
    except Exception:
        return

def _ensure_notifications_table():
    """Create notifications table if missing (MySQL/SQLite tolerant)."""
    try:
        # Try MySQL DDL first
        execute(
            """
            CREATE TABLE IF NOT EXISTS notifications (
              id BIGINT PRIMARY KEY AUTO_INCREMENT,
              user_id BIGINT NOT NULL,
              type VARCHAR(100) NOT NULL,
              payload JSON NULL,
              is_read TINYINT(1) NOT NULL DEFAULT 0,
              read_at DATETIME NULL,
              created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              INDEX idx_notif_user (user_id),
              INDEX idx_notif_created (created_at),
              INDEX idx_notif_unread (user_id,is_read)
            ) ENGINE=InnoDB
            """
        )
    except Exception:
        # SQLite fallback
        try:
            execute(
                """
                CREATE TABLE IF NOT EXISTS notifications (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_id INTEGER NOT NULL,
                  type TEXT NOT NULL,
                  payload TEXT,
                  is_read INTEGER NOT NULL DEFAULT 0,
                  read_at DATETIME,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        except Exception:
            pass


def _push(user_id: int, data: dict):
    """Send transient real-time event (no DB persistence).

    Debounced for some event types to reduce noise. Silent failures by design.
    """
    try:
        key = (user_id, data.get('type'))
        now = time.time()
        if data.get('type') == 'dm_unread_total':  # Example high-frequency event type
            last = _PUSH_LAST.get(key, 0)
            if now - last < 1.0:
                return
            _PUSH_LAST[key] = now
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(f"notif_{user_id}", {'type':'notify','data': data})
    except Exception:
        pass


def api_view(view_fn=None, *, require_auth=False, csrf=True, methods=None, auth_methods=None):
    """Decorator adding JSON method guard, auth & CSRF enforcement.

    Args:
        require_auth (bool): Force auth for all methods when True.
        csrf (bool): Enforce custom header-based CSRF for mutating verbs.
        methods (list[str]): Restrict HTTP verbs (405 if violated).
        auth_methods (list[str]): Only require auth for these verbs (overrides require_auth False).

    Special dev mode: When settings.DEV_OPEN and DEBUG are both True, most auth/CSRF
    checks are relaxed to speed local prototyping. Production must disable DEV_OPEN.
    """
    if view_fn is None:
        return partial(api_view, require_auth=require_auth, csrf=csrf, methods=methods, auth_methods=auth_methods)

    @wraps(view_fn)
    def wrapper(request: HttpRequest, *args, **kwargs):
        if methods and request.method not in methods:
            return JsonResponse({'error': 'method_not_allowed'}, status=405)
        dev_open = bool(getattr(settings,'DEV_OPEN', False) and settings.DEBUG)
        need_auth = (require_auth or (auth_methods and request.method in auth_methods)) and not dev_open
        user = None
        # Acquire and validate user for protected cases or CSRF enforcement
        if need_auth or (csrf and request.method in ('POST','PUT','DELETE','PATCH')):
            user = _auth_user(request)
            if need_auth and not user:
                return JsonResponse({'error': 'auth_required'}, status=401)
            if csrf and request.method in ('POST','PUT','DELETE','PATCH') and not dev_open:
                if not user:
                    return JsonResponse({'error': 'auth_required'}, status=401)
                cserr = _check_csrf(request, user)
                if cserr:
                    return cserr
        # Opportunistic user attach (non-required endpoints can still know user)
        if user is None:
            try:
                hdr = request.headers.get('X-Auth-Token') if hasattr(request,'headers') else None
                if not hdr:
                    hdr = request.META.get('HTTP_X_AUTH_TOKEN')
                if hdr:
                    user = _auth_user(request)
            except Exception:
                pass
        return view_fn(request, *args, **kwargs, _user=user)
    # Exempt from Django's cookie CSRF; we rely on header token that rotates per auth token.
    return csrf_exempt(wrapper)


def _public_user_fields(u):
    """Whitelist safe subset of user columns for API exposure."""
    return {k: u[k] for k in ['id','email','full_name','role','status','avatar_url'] if k in u}


def paginate(request: HttpRequest, base_sql: str, params: list, *, count_sql: str=None, page_param='page', page_size_param='page_size', default_size=20, max_size=100, order_fragment=''):
    """Execute a paginated SELECT returning (rows, meta dict).

    Args:
        request: incoming HttpRequest (query params inspected)
        base_sql: SELECT ... FROM ... WHERE ... (without ORDER/LIMIT)
        params: list of parameters for base_sql
        count_sql: optional 'SELECT COUNT(1) FROM (...same filters...)' override. If not provided, will transform base_sql.
        page_param/page_size_param: query parameter names.
        order_fragment: ' ORDER BY ...' piece appended before LIMIT.

    Returns:
        rows: list of dict rows
        meta: {page,page_size,total,has_next,has_prev,total_pages,next_page,prev_page}
    """
    try:
        page = int(request.GET.get(page_param) or 1)
    except Exception:
        page = 1
    try:
        page_size = int(request.GET.get(page_size_param) or default_size)
    except Exception:
        page_size = default_size
    if page < 1:
        page = 1
    if page_size < 1:
        page_size = default_size
    if page_size > max_size:
        page_size = max_size

    # Derive COUNT(*) efficiently. If caller added complex SELECT columns, fallback wraps.
    if count_sql:
        total_row = query(count_sql, params)
    else:
        # naive transform: replace leading SELECT ... with SELECT COUNT(1) FROM (base_sql) t
        count_sql_gen = f"SELECT COUNT(1) as ct FROM ({base_sql}) _pgsub"
        total_row = query(count_sql_gen, params)
    total = total_row['ct'] if total_row and 'ct' in total_row else (list(total_row.values())[0] if total_row else 0)

    offset = (page - 1) * page_size
    if offset >= total and total != 0:
        # Requesting a page beyond range -> return empty page but keep metadata coherent
        rows = []
    else:
        limit_sql = base_sql + (order_fragment or '') + ' LIMIT %s OFFSET %s'
        rows = query(limit_sql, params + [page_size, offset], many=True) or []

    total_pages = ceil(total / page_size) if page_size else 1
    meta = {
        'page': page,
        'page_size': page_size,
        'total': total,
        'total_pages': total_pages,
        'has_next': page < total_pages,
        'has_prev': page > 1,
        'next_page': page + 1 if page < total_pages else None,
        'prev_page': page - 1 if page > 1 else None,
    }
    return rows, meta


__all__ = [
    'api_view','_rate_limited','_limit_str','_hash_password','_verify_password','_require_method','_auth_user','_check_csrf',
    '_audit','_audit_safe','_notify','_push','_public_user_fields','paginate','timezone','settings','query','execute'
]


# ---------------------- Persistent Rate Limiting (DB-backed) ----------------------
def enforce_rate_limit(request: HttpRequest, *, scope: str, limit: int, window_seconds: int = 60, key_extra: str = None):
    """Enforce a simple fixed-window rate limit stored in the rate_limits table.

    This supplements the in-memory `_rate_limited` function for deployments that
    run multiple worker processes where local deques would diverge. If the
    `rate_limits` table is absent (older migrations), it silently falls back to
    in-memory limiting to remain backward compatible.

    Args:
        request: HttpRequest (IP derived from META / headers)
        scope: logical scope label (e.g., 'login')
        limit: maximum hits allowed within the window
        window_seconds: length of window in seconds (default 60)
        key_extra: optional distinguishing string (e.g., user email)

    Returns:
        (allowed: bool, retry_after_seconds: int|None)
    """
    # Build a scope key. Prefer real client IP (respect common proxy headers lightly).
    ip = request.META.get('HTTP_X_FORWARDED_FOR', '').split(',')[0].strip() or request.META.get('REMOTE_ADDR') or 'unknown'
    base_key = f"{scope}:ip:{ip}"
    if key_extra:
        base_key += f":{key_extra}"

    # First consult in-memory limiter for fast path (protect DB under attack).
    limited, retry_after = _rate_limited(f"mem:{base_key}", limit, window_seconds)
    if limited:
        return False, retry_after or window_seconds

    # Attempt DB persistence. If table missing or errors, ignore (fallback already applied).
    try:
        # Determine window bucket start (truncate to window boundary using epoch math in SQL-agnostic Python side).
        now_ts = int(time.time())
        window_start = now_ts - (now_ts % window_seconds)
        # Convert to datetime string for MySQL/SQLite insertion (UTC assumption).
        from datetime import datetime, timezone as _tz
        window_dt = datetime.fromtimestamp(window_start, _tz.utc).replace(tzinfo=None)
        # Upsert semantics (MySQL) rely on ON DUPLICATE KEY. For sqlite fallback we emulate with two statements.
        engine = str(_conn.settings_dict.get('ENGINE',''))
        if 'mysql' in engine:
            execute("INSERT INTO rate_limits(scope_key,window_started_at,hit_count,last_hit_at) VALUES(%s,%s,1,NOW()) ON DUPLICATE KEY UPDATE hit_count=hit_count+1, last_hit_at=NOW()", [base_key, window_dt])
            row = query("SELECT hit_count FROM rate_limits WHERE scope_key=%s AND window_started_at=%s", [base_key, window_dt])
            hits = row['hit_count'] if row else 1
        else:
            # SQLite path: try update first
            updated = execute("UPDATE rate_limits SET hit_count=hit_count+1, last_hit_at=datetime('now') WHERE scope_key=%s AND window_started_at=%s", [base_key, window_dt])
            if not updated:
                execute("INSERT INTO rate_limits(scope_key,window_started_at,hit_count,last_hit_at) VALUES(%s,%s,1,datetime('now'))", [base_key, window_dt])
                hits = 1
            else:
                row = query("SELECT hit_count FROM rate_limits WHERE scope_key=%s AND window_started_at=%s", [base_key, window_dt])
                hits = row['hit_count'] if row else 1
        if hits > limit:
            # Compute retry-after as remaining seconds in window
            remaining = window_seconds - (now_ts - window_start)
            return False, remaining if remaining > 0 else window_seconds
    except Exception:
        # Suppress errors (schema missing etc.)
        pass
    return True, None

__all__.append('enforce_rate_limit')

# ---------------------- Error + Validation Helpers (minimal hardening) ----------------------
from django.http import JsonResponse as _JsonResponse
try:
    from .error_codes import get_error_spec
except Exception:  # pragma: no cover - defensive import guard
    def get_error_spec(_c):
        return None

def api_error(code: str, http_status: int | None = None, detail: str | None = None, extra: dict | None = None):
    """Return standardized error envelope.

    Args:
        code: canonical error code string.
        http_status: override HTTP status (falls back to catalog then 400).
        detail: optional override detail message (falls back to catalog default if present).
        extra: optional dict merged at top-level (NOT inside error object) e.g. {'retry_after': 12}.
    Structure:
        {"error": {"code": <code>, "detail": <optional>}, ...extra}
    """
    spec = get_error_spec(code)
    status = http_status or (spec['http'] if spec else 400)
    use_detail = detail or (spec.get('detail') if spec else None)
    payload = {'error': {'code': code}}
    if use_detail:
        payload['error']['detail'] = use_detail
    if extra:
        payload.update(extra)
    return _JsonResponse(payload, status=status)

def validate_password_minimal(pw: str):
    """Very light password policy: >=8 chars and at least a digit OR symbol."""
    if not pw or len(pw) < 8:
        return False, 'password_too_short'
    if not any(c.isdigit() for c in pw) and not any(c in '!@#$%^&*()-_=+[]{};:,.<>?/\\' for c in pw):
        return False, 'password_weak'
    return True, None

__all__.extend(['api_error','validate_password_minimal'])

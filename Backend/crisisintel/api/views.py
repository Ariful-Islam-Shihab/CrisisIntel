"""HTTP API endpoint implementations (raw SQL powered).

Each view here is intentionally explicit: we perform authentication (via decorator),
validate input, compose SQL, and shape JSON responses manually—matching the
"no ORM" project constraint. For clarity, each endpoint documents its purpose,
inputs, and notable behaviors.
"""

from django.http import JsonResponse, HttpRequest
from django.db.utils import IntegrityError as DBIntegrityError
import json
from .db import query, execute
from .utils import api_view, _limit_str, _hash_password, _verify_password, _require_method, _public_user_fields, _notify, api_error, validate_password_minimal
from django.conf import settings
import os, uuid
import time
import re

try:
    import requests as _req
except Exception:  # pragma: no cover - optional dependency
    _req = None

def _ai_specialty_suggestion(symptoms: str) -> str:
    """Lightweight heuristic fallback: map symptom keywords to a doctor specialty.

    This is used only when a local LLM (Ollama) isn't available.
    """
    s = (symptoms or '').lower()
    def has(*words):
        return any(w in s for w in words)
    if has('chest pain', 'pressure', 'palpitation', 'shortness of breath'):
        return 'Cardiologist'
    if has('headache', 'migraine', 'seizure', 'memory', 'stroke', 'numbness', 'tingling', 'dizziness'):
        return 'Neurologist'
    if has('abdominal', 'stomach', 'nausea', 'vomit', 'diarrhea', 'constipation', 'acid', 'heartburn'):
        return 'Gastroenterologist'
    if has('rash', 'itch', 'acne', 'psoriasis', 'eczema'):
        return 'Dermatologist'
    if has('joint', 'knee', 'shoulder', 'back pain', 'sprain', 'fracture'):
        return 'Orthopedic specialist'
    if has('fever', 'cough', 'sore throat', 'flu', 'infection'):
        return 'Internal Medicine / General Physician'
    if has('anxiety', 'depression', 'panic', 'stress', 'sleep'):
        return 'Psychiatrist or Clinical Psychologist'
    if has('pregnan', 'gyneco', 'period', 'menstru', 'pelvic'):
        return 'Gynecologist/Obstetrician'
    if has('urine', 'urinary', 'kidney', 'renal', 'stones'):
        return 'Urologist or Nephrologist'
    if has('diabetes', 'thyroid', 'hormone'):
        return 'Endocrinologist'
    return 'Primary Care / General Physician'

def _ai_build_system_prompt() -> str:
    return (
        "You are CrisisIntel Assistant, a helpful AI for a crisis and healthcare app. "
        "Be concise, friendly, and practical. \n"
        "Core abilities: \n"
        "- Answer general questions about using the app and navigating features. \n"
        "- Given user-described symptoms, suggest which type of doctor or service might be appropriate. \n"
        "- Provide basic, non-diagnostic guidance and red-flag advice to seek emergency help when needed. \n"
        "Language & formatting rules: \n"
        "- Respond in English only. Do not include words or sentences in any other language. \n"
        "- Keep answers under 12 sentences unless explicitly asked for depth. \n"
        "- Include a brief safety disclaimer: you are not a medical professional and this is not a diagnosis. \n"
        "- If symptoms sound life-threatening (e.g., severe chest pain, difficulty breathing, stroke signs), advise urgent/emergency care."
    )

# ------------------------ Ollama integration helpers -------------------------
# Lightweight cache of installed Ollama models to avoid hitting /api/tags on every request
_OLLAMA_TAGS_CACHE = { 'ts': 0.0, 'names': [] }

def _ollama_url() -> str:
    """Resolve Ollama base URL from settings or env, falling back to local default.

    This avoids requiring the user to set environment variables.
    """
    try:
        # Prefer Django settings if provided
        base = getattr(settings, 'OLLAMA_URL', None)
        if base:
            return str(base).rstrip('/')
    except Exception:
        pass
    import os as _os
    return (_os.environ.get('OLLAMA_URL') or 'http://127.0.0.1:11434').rstrip('/')

def _ollama_installed_models() -> list:
    """Return a list of installed Ollama model names using /api/tags.

    Uses a short in-memory cache. Returns [] if unreachable or requests missing.
    """
    if _req is None:
        return []
    try:
        import time as _time
        now = _time.time()
        if now - float(_OLLAMA_TAGS_CACHE.get('ts') or 0) < 60 and _OLLAMA_TAGS_CACHE.get('names'):
            return list(_OLLAMA_TAGS_CACHE['names'])
        url = _ollama_url() + '/api/tags'
        r = _req.get(url, timeout=5)
        if r.status_code == 200:
            j = r.json() or {}
            models = j.get('models') or j.get('tags') or []
            names = []
            for m in models:
                is_remote = False
                name = None
                if isinstance(m, dict):
                    name = m.get('name') or m.get('model')
                    # Exclude cloud/remote-only entries surfaced by Ollama Cloud
                    if m.get('remote_host') or m.get('remote'):
                        is_remote = True
                else:
                    name = str(m) if m is not None else None
                if not name:
                    continue
                # Also exclude names that clearly denote cloud variants
                if re.search(r'(:|-)\s*cloud\b', name, flags=re.IGNORECASE):
                    continue
                if is_remote:
                    continue
                names.append(name)
            _OLLAMA_TAGS_CACHE['ts'] = now
            _OLLAMA_TAGS_CACHE['names'] = names
            return names
    except Exception:
        pass
    return []

@api_view(require_auth=False, methods=['GET'], csrf=False)
def ai_models(request: HttpRequest, _user=None):
    """Return local Ollama model list and effective chosen model.

    Response: { installed: string[], chosen: string, url: string }
    Cloud-only entries are filtered out.
    """
    installed = _ollama_installed_models()
    chosen = _select_ollama_model(None)
    return JsonResponse({'installed': installed, 'chosen': chosen, 'url': _ollama_url()})

@api_view(require_auth=False, methods=['POST'], csrf=False)
def ai_pull_model(request: HttpRequest, _user=None):
    """Trigger an Ollama pull for a given model name.

    Body: { name: string }
    Returns: { ok: true, name }
    """
    if _req is None:
        return JsonResponse({'error': 'requests_missing'}, status=500)
    try:
        data = json.loads(request.body or '{}')
    except Exception:
        data = {}
    name = (data.get('name') or '').strip()
    if not name:
        return JsonResponse({'error': 'missing_fields', 'detail': 'name required'}, status=400)
    try:
        # Non-streaming pull; backend returns when complete. Frontend may prefer to call Ollama directly for progress.
        url = _ollama_url() + '/api/pull'
        r = _req.post(url, json={'name': name}, timeout=300)
        if r.status_code >= 200 and r.status_code < 300:
            return JsonResponse({'ok': True, 'name': name})
        return JsonResponse({'error': 'pull_failed', 'detail': r.text}, status=502)
    except Exception as e:
        return JsonResponse({'error': 'pull_exception', 'detail': str(e)}, status=500)

@api_view(require_auth=False, methods=['GET'], csrf=False)
def ai_health(request: HttpRequest, _user=None):
    """Lightweight readiness check for AI integration."""
    installed = _ollama_installed_models()
    url = _ollama_url()
    ok = bool(installed)
    return JsonResponse({'ok': ok, 'url': url, 'installed': installed, 'chosen': _select_ollama_model(None)})

def _select_ollama_model(requested: str | None = None) -> str:
    """Choose a model to use without requiring env variables.

    Priority:
      1) per-request 'model' if provided
      2) settings.OLLAMA_DEFAULT_MODEL if provided
      3) env OLLAMA_MODEL if provided
      4) preferred installed list (qwen2.5:7b-instruct, llama3.1:8b-instruct, mistral:7b-instruct, llama3.2:3b-instruct)
      5) first installed model
      6) hardcoded default 'qwen2.5:7b-instruct'
    """
    if requested:
        return requested.strip()
    try:
        default_from_settings = getattr(settings, 'OLLAMA_DEFAULT_MODEL', None)
        if default_from_settings:
            return str(default_from_settings).strip()
    except Exception:
        pass
    import os as _os
    env_model = (_os.environ.get('OLLAMA_MODEL') or '').strip()
    if env_model:
        return env_model
    installed = _ollama_installed_models()
    # Prefer English-first models to avoid mixed-language outputs
    prefs = ['llama3.2:3b', 'llama3.1:8b-instruct', 'mistral:7b-instruct', 'qwen2.5:7b-instruct']
    for p in prefs:
        if p in installed:
            return p
    if installed:
        return installed[0]
    # Fallback default (small, English-first)
    return 'llama3.2:3b'

def _contains_non_english(text: str) -> bool:
    """Heuristic: detect presence of common non-Latin scripts (CJK, Hangul, etc.)."""
    try:
        import re as _re
        return bool(_re.search(r"[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]", text or ""))
    except Exception:
        return False

@api_view(require_auth=False, methods=['POST'], csrf=False)
def ai_chat(request: HttpRequest, _user=None):
    """Stateless chat endpoint backed by a local Ollama model when available.

    Request JSON: { messages: [{ role: 'user'|'assistant'|'system', content: str }], model?: str }
    Response: { reply, model, via }

    - Prefers local Ollama at http://127.0.0.1:11434 using the chat API.
    - Default model can be overridden via env OLLAMA_MODEL; fallback 'llama3.2:3b'.
    - If Ollama is unavailable, returns a heuristic suggestion for doctor specialty
      when user asks about symptoms; otherwise a generic fallback guidance.
    """
    try:
        data = json.loads(request.body or '{}')
    except Exception:
        data = {}
    messages = data.get('messages') or []
    # Choose model automatically; per-request and settings overrides are honored, env optional.
    model = _select_ollama_model((data.get('model') or '').strip() or None)

    # Always prepend a system prompt for safety and tasking
    sys_msg = {'role': 'system', 'content': _ai_build_system_prompt()}
    msgs = [sys_msg]
    for m in messages:
        try:
            role = 'user' if m.get('role') not in ('user','assistant','system') else m.get('role')
            content = _limit_str(str(m.get('content') or ''), 8000)
            if content:
                msgs.append({'role': role, 'content': content})
        except Exception:
            continue

    # Try local Ollama if reachable and requests is installed
    if _req is not None:
        try:
            url = _ollama_url() + '/api/chat'
            resp = _req.post(url, json={'model': model, 'messages': msgs, 'stream': False}, timeout=60)
            if resp.status_code == 200:
                j = resp.json()
                msg = j.get('message') or {}
                reply = (msg.get('content') or '').strip()
                if reply:
                    # If reply appears to contain non-English characters, retry once with a stricter system prompt
                    if _contains_non_english(reply):
                        strict_msgs = msgs.copy()
                        strict_msgs[0] = { 'role': 'system', 'content': _ai_build_system_prompt() + "\nIMPORTANT: Respond in English only." }
                        resp_retry = _req.post(url, json={'model': model, 'messages': strict_msgs, 'stream': False}, timeout=60)
                        if resp_retry.status_code == 200:
                            j2 = resp_retry.json(); msg2 = (j2.get('message') or {})
                            reply2 = (msg2.get('content') or '').strip()
                            if reply2 and not _contains_non_english(reply2):
                                return JsonResponse({'reply': reply2, 'model': j2.get('model') or model, 'via': 'ollama'})
                    return JsonResponse({'reply': reply, 'model': j.get('model') or model, 'via': 'ollama'})
            # If the chosen model isn't installed, retry once with an available model
            try:
                jerr = resp.json() if hasattr(resp, 'json') else None
            except Exception:
                jerr = None
            msg_err = (jerr or {}).get('error') if isinstance(jerr, dict) else None
            if resp.status_code in (400,404) or (isinstance(msg_err, str) and 'model' in msg_err.lower() and 'found' in msg_err.lower()):
                alt = _select_ollama_model(None)
                # If auto-select returns the same missing model, try a small, common public model to trigger auto-pull
                if not alt or alt == model:
                    for p in ['llama3.2:3b', 'qwen2.5:7b-instruct', 'mistral:7b-instruct', 'llama3.1:8b-instruct']:
                        if p != model:
                            alt = p
                            break
                if alt and alt != model:
                    resp2 = _req.post(url, json={'model': alt, 'messages': msgs, 'stream': False}, timeout=60)
                    if resp2.status_code == 200:
                        j2 = resp2.json()
                        msg2 = j2.get('message') or {}
                        reply2 = (msg2.get('content') or '').strip()
                        if reply2:
                            return JsonResponse({'reply': reply2, 'model': j2.get('model') or alt, 'via': 'ollama'})
        except Exception:
            pass

    # Fallback: simple heuristic for specialty suggestion
    user_text = ''
    for m in reversed(messages or []):
        if isinstance(m, dict) and m.get('role') == 'user' and m.get('content'):
            user_text = str(m['content'])
            break
    # If the text doesn't look like symptoms, respond generically.
    looks_medical = any(w in (user_text or '').lower() for w in [
        'pain','fever','cough','rash','shortness','breath','nausea','vomit','dizzy','bleed','swelling','injury','fracture','headache','chest','throat','diarrhea','constipation','palpitation'
    ])
    if looks_medical and user_text:
        specialty = _ai_specialty_suggestion(user_text)
        disclaimer = (
            "Note: I’m not a medical professional. This isn’t a diagnosis. If symptoms are severe or worsening, seek urgent care or call your local emergency number."
        )
        reply = (
            f"Based on what you described, a {specialty} may be a good place to start. "
            f"They can evaluate your symptoms and direct you if another specialist is needed. {disclaimer}"
        )
    else:
        reply = (
            "Hi! I couldn’t reach the local AI model right now, so I’m using a lightweight helper. "
            "Ask me anything about the app (posting, requests, deployments) or describe your symptoms for a doctor-type suggestion."
        )
    return JsonResponse({'reply': reply, 'model': 'heuristic', 'via': 'fallback'})

@api_view(methods=['POST'], csrf=False)
def register(request: HttpRequest, _user=None):
    """Create a user account (org roles auto-active, no approval flow).

    Doctors are not a separate role; if 'doctor' provided it's normalized to 'regular'.
    Organization roles remain constrained to a single global account each.
    """
    data = json.loads(request.body or '{}')
    email = (data.get('email') or '').strip().lower()
    password = data.get('password')
    full_name = _limit_str(data.get('full_name', ''), 255)
    role = (data.get('role') or 'regular').strip().lower()
    # Allow multiple organization accounts except keep a single admin.
    if role == 'doctor':
        role = 'regular'
    if not email or not password:
        return api_error('missing_fields')
    ok_pw, pw_code = validate_password_minimal(password)
    if not ok_pw:
        return api_error(pw_code)
    status_val = 'active'
    try:
        user_id = execute("INSERT INTO users(email,password_hash,full_name,role,status) VALUES(%s,%s,%s,%s,%s)", [email, _hash_password(password), full_name, role, status_val])
    except Exception as e:
        return api_error('registration_failed', detail=str(e))
    # Auto-create fire department for fire_service role
    if role == 'fire_service':
        try:
            existing = query('SELECT id FROM fire_departments WHERE user_id=%s LIMIT 1', [user_id])
            if not existing:
                base_name = (email or 'Fire').split('@')[0]
                execute('INSERT INTO fire_departments(user_id,name,lat,lng) VALUES(%s,%s,%s,%s)', [user_id, f"{base_name} Department", None, None])
        except Exception:
            # Non-fatal; user can still proceed, upgrade endpoint also auto-creates later
            pass
    return JsonResponse({'ok': True, 'user_id': user_id, 'status': status_val})

@api_view(methods=['GET'], csrf=False)
def news_feed(request: HttpRequest, _user=None):
    """Return unified feed of posts and shares (latest first).

    We UNION original posts with share actions so each share appears as its own
    chronological feed item. Each row has a `feed_type` distinguishing source.

    Returned columns (per item):
        post_id: Original post primary key
        share_id: Share primary key if feed_type == 'share' else null
        feed_type: 'post' | 'share'
        item_time: Timestamp driving ordering (post.created_at or share.created_at)
        actor_name: The user shown as performing the action (author or sharer)
        share_comment: Optional note provided by sharer
        body, image_url: Original post content
        original_author_name: Attribution for the original post
        original_created_at: Original post creation timestamp
        post_author_id: Author user id
        post_updated_at: For showing 'edited' indicator if changed since creation
        comment_count: Pre-aggregated count of comments for quick display
        share_user_id: Sharer id when feed_type == 'share'
    """
    rows = query(
        """
        SELECT * FROM (
            SELECT
                p.id AS post_id,
                NULL AS share_id,
                'post' AS feed_type,
                p.created_at AS item_time,
                u.full_name AS actor_name,
                u.id AS actor_user_id,
                u.avatar_url AS actor_avatar_url,
                NULL AS share_comment,
                p.body,
                p.image_url,
                u.full_name AS original_author_name,
                p.created_at AS original_created_at,
                p.author_id AS post_author_id,
                p.updated_at AS post_updated_at,
                COALESCE(cc.comment_count, 0) AS comment_count,
                NULL AS share_user_id,
                u.avatar_url AS original_author_avatar_url
            FROM posts p
            JOIN users u ON u.id = p.author_id
            LEFT JOIN (
                SELECT post_id, COUNT(*) AS comment_count
                FROM post_comments
                GROUP BY post_id
            ) cc ON cc.post_id = p.id
            UNION ALL
            SELECT
                p.id AS post_id,
                s.id AS share_id,
                'share' AS feed_type,
                s.created_at AS item_time,
                su.full_name AS actor_name,
                su.id AS actor_user_id,
                su.avatar_url AS actor_avatar_url,
                s.comment AS share_comment,
                p.body,
                p.image_url,
                au.full_name AS original_author_name,
                p.created_at AS original_created_at,
                p.author_id AS post_author_id,
                p.updated_at AS post_updated_at,
                COALESCE(cc.comment_count, 0) AS comment_count,
                s.user_id AS share_user_id,
                au.avatar_url AS original_author_avatar_url
            FROM post_shares s
            JOIN users su ON su.id = s.user_id
            JOIN posts p ON p.id = s.post_id
            JOIN users au ON au.id = p.author_id
            LEFT JOIN (
                SELECT post_id, COUNT(*) AS comment_count
                FROM post_comments
                GROUP BY post_id
            ) cc ON cc.post_id = p.id
            UNION ALL
            SELECT
                -c.id AS post_id,
                NULL AS share_id,
                'campaign' AS feed_type,
                c.created_at AS item_time,
                u.full_name AS actor_name,
                u.id AS actor_user_id,
                u.avatar_url AS actor_avatar_url,
                NULL AS share_comment,
                c.title AS body,
                NULL AS image_url,
                u.full_name AS original_author_name,
                c.created_at AS original_created_at,
                u.id AS post_author_id,
                c.created_at AS post_updated_at,
                0 AS comment_count,
                NULL AS share_user_id,
                u.avatar_url AS original_author_avatar_url
            FROM campaigns c
            JOIN users u ON u.id = c.owner_user_id
            WHERE c.status IN ('active','draft')
        ) t
        ORDER BY t.item_time DESC
        LIMIT 100
        """,
        many=True,
    ) or []
    return JsonResponse({
        'results': rows
    })

@api_view(methods=['POST'], csrf=False)
def login(request: HttpRequest, _user=None):
    """Authenticate user and issue auth + CSRF tokens.

    Body JSON: { email, password }
    Returns: { token, csrf_token, user }

    CSRF disabled (no token yet). Tokens expire after 7 days (see SQL expression).
    """
    data = json.loads(request.body or '{}')
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    if not email or not password:
        return api_error('missing_fields')
    user = query("SELECT * FROM users WHERE email=%s", [email])
    if not user or not _verify_password(password, user['password_hash']):
        # Apply rate limiting ONLY on failed attempts so successful logins during
        # test suite setup (many sequential accounts) are not penalized.
        from .utils import enforce_rate_limit
        # IP-wide limiter (higher threshold)
        allowed_ip, retry_ip = enforce_rate_limit(request, scope='login', limit=50, window_seconds=60)
        if not allowed_ip:
            return api_error('rate_limited', extra={'retry_after': retry_ip})
        # Email specific limiter (tighter threshold)
        allowed_user, retry_user = enforce_rate_limit(request, scope='login_user', limit=10, window_seconds=60, key_extra=email)
        if not allowed_user:
            return api_error('rate_limited', extra={'retry_after': retry_user})
        return api_error('invalid_credentials')
    import secrets
    token = secrets.token_hex(32)
    csrf = secrets.token_hex(16)
    from django.db import connection as _c
    exp = "datetime('now','+7 day')" if 'sqlite' in str(_c.settings_dict.get('ENGINE','')) else "DATE_ADD(NOW(), INTERVAL 7 DAY)"
    execute(f"INSERT INTO auth_tokens(user_id, token, csrf_token, expires_at) VALUES(%s,%s,%s,{exp})", [user['id'], token, csrf])
    # Ensure fire_service users have an associated department (idempotent backfill)
    try:
        if user.get('role') == 'fire_service':
            dept = query('SELECT id FROM fire_departments WHERE user_id=%s LIMIT 1', [user['id']])
            if not dept:
                base_name = (user.get('email') or 'Fire').split('@')[0]
                execute('INSERT INTO fire_departments(user_id,name,lat,lng) VALUES(%s,%s,%s,%s)', [user['id'], f"{base_name} Department", None, None])
    except Exception:
        pass
    # Issue cookies in addition to JSON so browser apps can rely on cookies if desired.
    # Note: For cross-origin dev, frontend must use fetch(..., { credentials: 'include' }) and backend CORS must allow credentials.
    resp = JsonResponse({'token': token, 'csrf_token': csrf, 'user': _public_user_fields(user)})
    seven_days = 7 * 24 * 3600
    try:
        resp.set_cookie('auth_token', token, max_age=seven_days, httponly=True, samesite='Lax', path='/')
        # Expose CSRF token in a non-HttpOnly cookie so JS can mirror it into X-CSRF-Token header for POSTs
        resp.set_cookie('csrf_token', csrf, max_age=seven_days, httponly=False, samesite='Lax', path='/')
    except Exception:
        # Never fail login if cookie setting fails
        pass
    return resp

@api_view(require_auth=True, methods=['POST'], csrf=False)
def create_post(request: HttpRequest, _user=None):
    """Create a new post owned by the authenticated user.

    Body JSON: { body, image_url? }
    Returns: { id }
    """
    data = json.loads(request.body or '{}')
    body = _limit_str(data.get('body', ''), 5000)
    image_url = data.get('image_url')
    post_id = execute("INSERT INTO posts(author_id, body, image_url) VALUES(%s,%s,%s)", [_user['id'], body, image_url])
    return JsonResponse({'id': post_id})

@api_view(require_auth=False, methods=['GET', 'PUT', 'DELETE'], csrf=False)
def post_item(request: HttpRequest, post_id: int, _user=None):
    """Update or delete a post belonging to the current user.

    PUT Body JSON: { body, image_url }
    DELETE: no body
    Permissions: Must be author of the post.
    """
    post = query("SELECT * FROM posts WHERE id=%s", [post_id])
    if not post:
        return JsonResponse({'error': 'not_found'}, status=404)
    if request.method in ('PUT','DELETE'):
        if not _user:
            return JsonResponse({'error': 'auth_required'}, status=401)
    if request.method in ('PUT','DELETE') and post['author_id'] != _user['id']:
        return JsonResponse({'error': 'forbidden'}, status=403)
    if request.method == 'GET':
        # Public read of a single post (author basic info joined)
        row = query("""
            SELECT p.id as post_id, p.body, p.image_url, p.created_at, p.updated_at,
                   u.id as author_id, u.full_name as author_name, u.email as author_email
            FROM posts p JOIN users u ON u.id=p.author_id WHERE p.id=%s
        """, [post_id])
        if not row:
            return JsonResponse({'error': 'not_found'}, status=404)
        return JsonResponse(row)
    if request.method == 'PUT':
        data = json.loads(request.body or '{}')
        body = _limit_str(data.get('body', ''), 5000)
        image_url = data.get('image_url')
        execute("UPDATE posts SET body=%s, image_url=%s WHERE id=%s AND author_id=%s", [body, image_url, post_id, _user['id']])
        return JsonResponse({'ok': True})
    if request.method == 'DELETE':
        execute("DELETE FROM posts WHERE id=%s AND author_id=%s", [post_id, _user['id']])
        return JsonResponse({'ok': True})
    return JsonResponse({'error': 'method_not_allowed'}, status=405)

@api_view(require_auth=True, methods=['POST'], csrf=False)
def share_post(request: HttpRequest, post_id: int, _user=None):
    """Create a share record for a post with optional comment.

    Body JSON: { comment? }
    Returns: { id }
    Defensive re-auth performed when DEV_OPEN mode relaxes strict decorator check.
    """
    # Be defensive in DEV_OPEN mode where auth may not be strictly enforced
    if not _user:
        # Try to authenticate from header token if present
        from .utils import _auth_user
        _user = _auth_user(request)
        if not _user:
            return JsonResponse({'error': 'auth_required'}, status=401)

    # Ensure the target post exists (clean 404 vs DB FK error)
    post = query("SELECT id FROM posts WHERE id=%s", [post_id])
    if not post:
        return JsonResponse({'error': 'not_found'}, status=404)

    data = json.loads(request.body or '{}')
    comment = data.get('comment')
    try:
        share_id = execute("INSERT INTO post_shares(post_id,user_id,comment) VALUES(%s,%s,%s)", [post_id, _user['id'], comment])
        # Notify original author their post was shared (best-effort)
        try:
            post_row = query("SELECT author_id FROM posts WHERE id=%s", [post_id])
            if post_row and int(post_row.get('author_id')) != int(_user['id']):
                _notify(int(post_row['author_id']), 'post_shared', {'post_id': post_id, 'share_id': share_id, 'by_user_id': _user['id']})
        except Exception:
            pass
    except Exception as e:
        return JsonResponse({'error': 'share_failed', 'detail': str(e)}, status=400)
    return JsonResponse({'id': share_id})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def create_comment(request: HttpRequest, post_id: int, _user=None):
    """Add a comment to a post.

    Body JSON: { body }
    Returns: { id }
    """
    data = json.loads(request.body or '{}')
    body = _limit_str(data.get('body', ''), 2000)
    comment_id = execute("INSERT INTO post_comments(post_id,user_id,body) VALUES(%s,%s,%s)", [post_id, _user['id'], body])
    # Notify post author about new comment (best-effort)
    try:
        post_row = query("SELECT author_id FROM posts WHERE id=%s", [post_id])
        if post_row and int(post_row.get('author_id')) != int(_user['id']):
            _notify(int(post_row['author_id']), 'post_comment', {'post_id': post_id, 'comment_id': comment_id, 'by_user_id': _user['id']})
    except Exception:
        pass
    return JsonResponse({'id': comment_id})

@api_view(methods=['GET'], csrf=False)
def list_comments(request: HttpRequest, post_id: int, _user=None):
    """List comments for a post ordered by creation ascending."""
    rows = query(
        """
        SELECT pc.*, u.full_name AS author_name, u.avatar_url AS author_avatar_url
        FROM post_comments pc
        JOIN users u ON u.id = pc.user_id
        WHERE pc.post_id = %s
        ORDER BY pc.created_at ASC
        """,
        [post_id], many=True
    ) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['PUT', 'DELETE'], csrf=False)
def comment_item(request: HttpRequest, comment_id: int, _user=None):
    """Update or delete a comment owned by the current user.

    PUT Body JSON: { body }
    DELETE: no body
    """
    comment = query("SELECT * FROM post_comments WHERE id=%s", [comment_id])
    if not comment:
        return JsonResponse({'error': 'not_found'}, status=404)
    if comment['user_id'] != _user['id']:
        return JsonResponse({'error': 'forbidden'}, status=403)
    if request.method == 'PUT':
        data = json.loads(request.body or '{}')
        body = _limit_str(data.get('body', ''), 2000)
        execute("UPDATE post_comments SET body=%s WHERE id=%s AND user_id=%s", [body, comment_id, _user['id']])
        return JsonResponse({'ok': True})
    if request.method == 'DELETE':
        execute("DELETE FROM post_comments WHERE id=%s AND user_id=%s", [comment_id, _user['id']])
        return JsonResponse({'ok': True})
    return JsonResponse({'error': 'method_not_allowed'}, status=405)

@api_view(methods=['GET'], csrf=False)
def list_shares(request: HttpRequest, post_id: int, _user=None):
    """Return shares for a given post (latest first)."""
    rows = query("SELECT ps.*, u.full_name AS user_name FROM post_shares ps JOIN users u ON u.id=ps.user_id WHERE ps.post_id=%s ORDER BY ps.id DESC", [post_id], many=True) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['PUT', 'DELETE'], csrf=False)
def share_item(request: HttpRequest, share_id: int, _user=None):
    """Edit or delete an existing share by its owner.

    PUT Body JSON: { comment }
    DELETE: no body
    """
    # Defensive re-auth (mirrors share_post reasoning)
    if not _user:
        from .utils import _auth_user
        _user = _auth_user(request)
        if not _user:
            return JsonResponse({'error': 'auth_required'}, status=401)
    share = query("SELECT * FROM post_shares WHERE id=%s", [share_id])
    if not share:
        return JsonResponse({'error': 'not_found'}, status=404)
    if share['user_id'] != _user['id']:
        return JsonResponse({'error': 'forbidden'}, status=403)
    if request.method == 'PUT':
        data = json.loads(request.body or '{}')
        comment = data.get('comment')
        execute("UPDATE post_shares SET comment=%s WHERE id=%s AND user_id=%s", [comment, share_id, _user['id']])
        return JsonResponse({'ok': True})
    if request.method == 'DELETE':
        execute("DELETE FROM post_shares WHERE id=%s AND user_id=%s", [share_id, _user['id']])
        return JsonResponse({'ok': True})
    return JsonResponse({'error': 'method_not_allowed'}, status=405)

@api_view(methods=['GET'], csrf=False)
def search(request: HttpRequest, _user=None):
    """Search posts, doctors, hospitals by substring match.

    Query Param: q (string)
    Returns: { posts: [...], doctors: [...], hospitals: [...] }
    Simple LIKE-based search (case-insensitive by default with MySQL collation).
    """
    q = (request.GET.get('q') or '').strip()
    if not q:
        return JsonResponse({
            'posts': [], 'doctors': [], 'hospitals': [],
            'users': [], 'fire_departments': [], 'fire_requests': []
        })
    like = f"%{q}%"
    # Be resilient if optional tables don't exist in the current schema.
    posts = []
    doctors = []
    hospitals = []
    users = []
    fire_departments = []
    fire_requests = []
    try:
        posts = query("SELECT id, body FROM posts WHERE body LIKE %s ORDER BY id DESC LIMIT 50", [like], many=True) or []
    except Exception:
        posts = []
    try:
        doctors = query("SELECT id, name, specialty FROM doctors WHERE name LIKE %s OR specialty LIKE %s ORDER BY id DESC LIMIT 50", [like, like], many=True) or []
    except Exception:
        doctors = []
    try:
        # Return hospitals matched by own name or by owning user's name/email
        hospitals_by_name = query("SELECT id, name FROM hospitals WHERE name LIKE %s ORDER BY id DESC LIMIT 50", [like], many=True) or []
        hospitals_by_owner = []
        try:
            hospitals_by_owner = query(
                """
                SELECT h.id, h.name
                FROM hospitals h
                JOIN users u ON u.id = h.user_id
                WHERE (u.full_name LIKE %s OR u.email LIKE %s)
                ORDER BY h.id DESC
                LIMIT 50
                """,
                [like, like], many=True
            ) or []
        except Exception:
            hospitals_by_owner = []
        # Merge unique by id
        seen_h = set()
        hospitals = []
        for r in hospitals_by_name + hospitals_by_owner:
            if not r: continue
            hid = r.get('id') if isinstance(r, dict) else None
            if hid is None or hid in seen_h: continue
            seen_h.add(hid)
            hospitals.append(r)
    except Exception:
        hospitals = []
    # Users by email or full name
    try:
        users = query("SELECT id, email, full_name, role FROM users WHERE email LIKE %s OR full_name LIKE %s ORDER BY id DESC LIMIT 50", [like, like], many=True) or []
    except Exception:
        users = []
    # Optional: fire departments by name
    try:
        fire_departments = query("SELECT id, name, lat, lng, user_id FROM fire_departments WHERE name LIKE %s ORDER BY id DESC LIMIT 50", [like], many=True) or []
    except Exception:
        fire_departments = []
    # Optional: fire service requests by description (public scope)
    try:
        fire_requests = query("SELECT id, description, status, assigned_department_id FROM fire_service_requests WHERE description LIKE %s ORDER BY id DESC LIMIT 50", [like], many=True) or []
    except Exception:
        fire_requests = []
    return JsonResponse({'posts': posts, 'doctors': doctors, 'hospitals': hospitals, 'users': users, 'fire_departments': fire_departments, 'fire_requests': fire_requests})


@api_view(require_auth=True, methods=['GET'], csrf=False)
def my_stats(request: HttpRequest, _user=None):
    """Return simple counts of posts and shares for the current user."""
    pc = query("SELECT COUNT(*) AS c FROM posts WHERE author_id=%s", [_user['id']]) or {'c': 0}
    sc = query("SELECT COUNT(*) AS c FROM post_shares WHERE user_id=%s", [_user['id']]) or {'c': 0}
    posts = int(pc['c'])
    shares = int(sc['c'])
    return JsonResponse({'posts': posts, 'shares': shares, 'total': posts + shares})


@api_view(require_auth=True, methods=['POST'], csrf=False)
def upload_image(request: HttpRequest, _user=None):
    """Handle authenticated image upload.

    Accepts multipart/form-data with a single part named 'file'. Stores image under
    MEDIA_ROOT/uploads/<user_id>/ generating a random filename to avoid collisions.
    Returns: { url }
    Security: basic extension & size checks; for production consider MIME sniffing
    and virus scanning depending on risk profile.
    """
    # Accept multipart/form-data with a single 'file' part
    if request.content_type is None or 'multipart/form-data' not in request.content_type:
        return JsonResponse({'error': 'invalid_content_type'}, status=400)
    f = request.FILES.get('file')
    if not f:
        return JsonResponse({'error': 'missing_file'}, status=400)
    if f.size > 5 * 1024 * 1024:
        return JsonResponse({'error': 'file_too_large'}, status=400)
    # Basic extension validation (lightweight defense-in-depth)
    name, ext = os.path.splitext(f.name)
    ext = (ext or '').lower()
    if ext not in ('.jpg', '.jpeg', '.png', '.gif', '.webp'):
        return JsonResponse({'error': 'unsupported_type'}, status=400)
    uid = uuid.uuid4().hex
    rel_dir = os.path.join('uploads', str(_user['id']))
    abs_dir = os.path.join(settings.MEDIA_ROOT, rel_dir)
    os.makedirs(abs_dir, exist_ok=True)
    filename = f"{uid}{ext}"
    abs_path = os.path.join(abs_dir, filename)
    with open(abs_path, 'wb') as out:
        for chunk in f.chunks():
            out.write(chunk)
    url = settings.MEDIA_URL + rel_dir.replace('\\','/') + '/' + filename
    return JsonResponse({ 'url': url })

# ---------------------------- PHASE 1 ADDITIONS ---------------------------------

def _require_admin(user):
    return user and user.get('role') == 'admin'

def _require_hospital(user):
    return user and user.get('role') == 'hospital'

# Users current profile endpoint for gating
@api_view(require_auth=True, methods=['GET'], csrf=False)
def current_user(request: HttpRequest, _user=None):
    # return minimal safe subset
    if not _user:
        return JsonResponse({'error':'unauthenticated'}, status=401)
    # fetch avatar_url & full_name if available
    row = None
    try:
        row = query("SELECT id,email,full_name,role,avatar_url FROM users WHERE id=%s", [_user['id']])
    except Exception:
        pass
    if row:
        return JsonResponse({'id': row.get('id'), 'email': row.get('email'), 'full_name': row.get('full_name'), 'role': row.get('role'), 'avatar_url': row.get('avatar_url')})
    return JsonResponse({'id': _user['id'], 'email': _user.get('email'), 'full_name': _user.get('name'), 'role': _user.get('role')})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def upgrade_fire_service(request: HttpRequest, _user=None):
    """Promote current user to fire_service role (idempotent)."""
    # If already fire_service ensure department exists (auto-create if missing)
    if _user.get('role') == 'fire_service':
        try:
            dept = query('SELECT id FROM fire_departments WHERE user_id=%s LIMIT 1', [_user['id']])
            if not dept:
                # Create with placeholder name and null coordinates (user can edit later)
                base_name = (_user.get('email') or 'Fire').split('@')[0]
                execute('INSERT INTO fire_departments(user_id,name,lat,lng) VALUES(%s,%s,%s,%s)', [_user['id'], f"{base_name} Department", None, None])
        except Exception:
            pass
        return JsonResponse({'ok': True, 'role': 'fire_service', 'auto_department': True})
    # Upgrade role first
    try:
        execute("UPDATE users SET role='fire_service' WHERE id=%s", [_user['id']])
    except Exception as e:
        return JsonResponse({'error':'upgrade_failed','detail':str(e)}, status=400)
    # Create department if not exists (fresh upgrade path)
    try:
        dept = query('SELECT id FROM fire_departments WHERE user_id=%s LIMIT 1', [_user['id']])
        if not dept:
            base_name = (_user.get('email') or 'Fire').split('@')[0]
            execute('INSERT INTO fire_departments(user_id,name,lat,lng) VALUES(%s,%s,%s,%s)', [_user['id'], f"{base_name} Department", None, None])
    except Exception:
        pass
    return JsonResponse({'ok': True, 'role': 'fire_service', 'auto_department': True})

# ---------------- Social Organizations -------------------------
@api_view(require_auth=True, methods=['POST'], csrf=False)
def add_social_organization(request: HttpRequest, _user=None):
    data = json.loads(request.body or '{}')
    name = (data.get('name') or '').strip()[:255]
    description = data.get('description')
    if not name:
        return JsonResponse({'error':'missing_name'}, status=400)
    try:
        oid = execute("INSERT INTO social_organizations(user_id,name,description) VALUES(%s,%s,%s)", [_user['id'], name, description])
    except Exception as e:
        return JsonResponse({'error':'insert_failed','detail':str(e)}, status=400)
    return JsonResponse({'id': oid})

@api_view(require_auth=False, methods=['GET'], csrf=False)
def list_social_organizations(request: HttpRequest, _user=None):
    rows = query("SELECT id,name,description,created_at FROM social_organizations ORDER BY name ASC", [], many=True) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def social_org_mine(request: HttpRequest, _user=None):
    """Return the current user's social organization, creating one if missing.

    This treats an NGO/Social account as the organization owner. If no row exists
    in `social_organizations` for this user, it will create one using the
    user's full name or email prefix as the name.
    """
    # Try to fetch existing
    try:
        row = query("SELECT id,name,description,created_at FROM social_organizations WHERE user_id=%s LIMIT 1", [_user['id']])
    except Exception:
        row = None
    if row:
        return JsonResponse(row)
    # Create one if missing
    try:
        # Determine a sensible name
        base_name = (_user.get('full_name') or (_user.get('email') or 'Organization').split('@')[0]).strip() or 'Organization'
        oid = execute("INSERT INTO social_organizations(user_id,name,description) VALUES(%s,%s,%s)", [_user['id'], base_name, None])
        created = query("SELECT id,name,description,created_at FROM social_organizations WHERE id=%s", [oid]) or {'id': oid, 'name': base_name}
        return JsonResponse(created)
    except Exception as e:
        return JsonResponse({'error': 'create_failed', 'detail': str(e)}, status=400)
# (removed obsolete conditional food donation block; canonical endpoints defined later)
# ---------------------------- PHASE 1 ADDITIONS END ---------------------------------

@api_view(require_auth=True, methods=['POST'], csrf=False)
def add_doctor_to_hospital(request: HttpRequest, hospital_id: int, _user=None):
    """Hospital (self) or admin: associate an existing user as doctor for hospital.

    Body: { doctor_user_id }
    """
    if not (_require_admin(_user) or (_require_hospital(_user) and _user['id']==hospital_id)):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    doctor_id = int(data.get('doctor_user_id') or 0)
    if not doctor_id:
        return JsonResponse({'error':'missing_doctor'}, status=400)
    # verify hospital account
    hosp = query("SELECT id FROM users WHERE id=%s AND role='hospital'", [hospital_id])
    if not hosp:
        return JsonResponse({'error':'hospital_not_found'}, status=404)
    # verify doctor user exists (any role except hospital/org maybe) but must be active
    doc = query("SELECT id,status FROM users WHERE id=%s", [doctor_id])
    if not doc or doc['status'] != 'active':
        return JsonResponse({'error':'doctor_not_active'}, status=400)
    # insert membership (ignore duplicates)
    existing = query("SELECT hospital_user_id FROM hospital_doctors WHERE hospital_user_id=%s AND doctor_user_id=%s", [hospital_id, doctor_id])
    if not existing:
        execute("INSERT INTO hospital_doctors(hospital_user_id,doctor_user_id) VALUES(%s,%s)", [hospital_id, doctor_id])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def remove_doctor_from_hospital(request: HttpRequest, hospital_id: int, _user=None):
    """Hospital (self) or admin: remove doctor association."""
    if not (_require_admin(_user) or (_require_hospital(_user) and _user['id']==hospital_id)):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    doctor_id = int(data.get('doctor_user_id') or 0)
    execute("DELETE FROM hospital_doctors WHERE hospital_user_id=%s AND doctor_user_id=%s", [hospital_id, doctor_id])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def set_doctor_profile(request: HttpRequest, _user=None):
    """Upsert a doctor's profile (name, specialty) by doctor_user_id.

    Body: { doctor_user_id, name?, specialty? }
    Auth: admin, the doctor user themself, or a hospital that has membership with the doctor.
    """
    data = json.loads(request.body or '{}')
    doctor_user_id = int(data.get('doctor_user_id') or 0)
    name = (data.get('name') or '').strip()
    specialty = (data.get('specialty') or '').strip()
    if not doctor_user_id:
        return JsonResponse({'error':'missing_doctor_user_id'}, status=400)
    if not name or not specialty:
        return JsonResponse({'error':'missing_fields', 'detail': 'name and specialty are required'}, status=400)
    # permission check
    allowed = False
    try:
        if _require_admin(_user):
            allowed = True
        elif _user and int(_user.get('id') or 0) == doctor_user_id:
            allowed = True
        else:
            mem = query("SELECT 1 FROM hospital_doctors WHERE doctor_user_id=%s AND hospital_user_id=%s LIMIT 1", [doctor_user_id, _user['id']])
            if mem:
                allowed = True
    except Exception:
        pass
    if not allowed:
        return JsonResponse({'error':'forbidden'}, status=403)
    # upsert into doctors table by user_id
    try:
        existing = query("SELECT id FROM doctors WHERE user_id=%s", [doctor_user_id])
        if existing:
            execute("UPDATE doctors SET name=%s, specialty=%s WHERE user_id=%s", [name, specialty, doctor_user_id])
            did = existing['id']
        else:
            did = execute("INSERT INTO doctors(user_id,name,specialty) VALUES(%s,%s,%s)", [doctor_user_id, name, specialty])
    except Exception as e:
        return JsonResponse({'error':'db_error','detail':str(e)}, status=400)
    return JsonResponse({'ok': True, 'doctor_id': did})

@api_view(methods=['GET'], csrf=False)
def list_hospital_doctors(request: HttpRequest, hospital_id: int, _user=None):
    """List doctors associated with a hospital (public)."""
    rows = query(
        """
        SELECT hd.doctor_user_id AS user_id,
               u.full_name, u.email,
               d.name AS doctor_name, d.specialty
        FROM hospital_doctors hd
        JOIN users u ON u.id=hd.doctor_user_id
        LEFT JOIN doctors d ON d.user_id = u.id
        WHERE hd.hospital_user_id=%s
        ORDER BY COALESCE(d.name, u.full_name) ASC
        """, [hospital_id], many=True) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def add_doctor_schedule(request: HttpRequest, hospital_id: int, _user=None):
    """Hospital (self) or admin: add weekly schedule block for a doctor.

    Body: { doctor_user_id, weekday (0-6), start_time 'HH:MM', end_time 'HH:MM', visit_cost (number), max_per_day (int) }
    Rules:
      - Hospital must be the caller (or admin)
      - If the doctor isn't a member of the hospital yet, automatically associate them
      - visit_cost and max_per_day are REQUIRED (per request)
    """
    if not (_require_admin(_user) or (_require_hospital(_user) and _user['id'] == hospital_id)):
        return JsonResponse({'error': 'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    doctor_id = int(data.get('doctor_user_id') or 0)
    weekday = data.get('weekday')
    start_time = data.get('start_time')
    end_time = data.get('end_time')
    visit_cost = data.get('visit_cost')
    max_per_day = data.get('max_per_day')
    if weekday is None or start_time is None or end_time is None or visit_cost is None or max_per_day is None:
        return JsonResponse({'error': 'missing_fields'}, status=400)
    try:
        visit_cost = float(visit_cost)
        max_per_day = int(max_per_day)
        if visit_cost < 0 or max_per_day <= 0:
            return JsonResponse({'error': 'invalid_fields'}, status=400)
    except Exception:
        return JsonResponse({'error': 'invalid_fields'}, status=400)
    # membership check (auto-associate if missing)
    mem = query("SELECT 1 FROM hospital_doctors WHERE hospital_user_id=%s AND doctor_user_id=%s", [hospital_id, doctor_id])
    if not mem:
        try:
            execute("INSERT INTO hospital_doctors(hospital_user_id,doctor_user_id) VALUES(%s,%s)", [hospital_id, doctor_id])
        except Exception:
            pass
    # insert schedule block (allow multiples) – final schema includes visit_cost & max_per_day
    execute(
        "INSERT INTO doctor_schedules(doctor_user_id,hospital_user_id,weekday,start_time,end_time,visit_cost,max_per_day) VALUES(%s,%s,%s,%s,%s,%s,%s)",
        [doctor_id, hospital_id, weekday, start_time, end_time, visit_cost, max_per_day]
    )
    return JsonResponse({'ok': True})

@api_view(methods=['GET'], csrf=False)
def list_doctor_schedule(request: HttpRequest, doctor_id: int, _user=None):
    """List schedule blocks for a doctor across hospitals."""
    rows = query("SELECT id,doctor_user_id,hospital_user_id,weekday,start_time,end_time,visit_cost,max_per_day FROM doctor_schedules WHERE doctor_user_id=%s ORDER BY weekday,start_time", [doctor_id], many=True) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def update_doctor_schedule(request: HttpRequest, hospital_id: int, schedule_id: int, _user=None):
    """Hospital (self) or admin: update a schedule block (weekday, times, cost, max_per_day)."""
    if not (_require_admin(_user) or (_require_hospital(_user) and _user['id'] == hospital_id)):
        return JsonResponse({'error': 'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    fields = {}
    if 'weekday' in data: fields['weekday'] = data['weekday']
    if 'start_time' in data: fields['start_time'] = data['start_time']
    if 'end_time' in data: fields['end_time'] = data['end_time']
    if 'visit_cost' in data:
        fields['visit_cost'] = float(data['visit_cost'])
    if 'max_per_day' in data:
        fields['max_per_day'] = int(data['max_per_day'])
    if not fields:
        return JsonResponse({'error':'nothing_to_update'}, status=400)
    # Restrict update to schedule rows owned by this hospital
    owned = query("SELECT id FROM doctor_schedules WHERE id=%s AND hospital_user_id=%s", [schedule_id, hospital_id])
    if not owned:
        return JsonResponse({'error':'not_found'}, status=404)
    sets = []
    args = []
    for k,v in fields.items():
        sets.append(f"{k}=%s")
        args.append(v)
    args.extend([schedule_id])
    execute("UPDATE doctor_schedules SET " + ",".join(sets) + " WHERE id=%s", args)
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def delete_doctor_schedule(request: HttpRequest, hospital_id: int, schedule_id: int, _user=None):
    """Hospital (self) or admin: delete a schedule block."""
    if not (_require_admin(_user) or (_require_hospital(_user) and _user['id'] == hospital_id)):
        return JsonResponse({'error': 'forbidden'}, status=403)
    execute("DELETE FROM doctor_schedules WHERE id=%s AND hospital_user_id=%s", [schedule_id, hospital_id])
    return JsonResponse({'ok': True})

# ---------------------- Hospital Services ------------------------------------

def _ensure_hospital_services_tables():
    # No-op: schema is managed by final_normalized_schema.sql
    return None

def _ensure_ambulance_service(hospital_user_id: int):
    """Ensure an 'Ambulance' service exists for a hospital. Returns its id.

    This is idempotent and keeps price at 0 with open window by default.
    """
    _ensure_hospital_services_tables()
    row = query("SELECT id FROM hospital_services WHERE hospital_user_id=%s AND LOWER(name)='ambulance'", [hospital_user_id])
    if row:
        return int(row['id'])
    # Create a lightweight service entry
    try:
        sid = execute(
            "INSERT INTO hospital_services(hospital_user_id,name,description,price,duration_minutes,available,max_per_day,window_start_time,window_end_time) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            [hospital_user_id, 'Ambulance', 'Emergency ambulance dispatch', 0, 0, 1, None, None, None]
        )
        return int(sid)
    except Exception:
        # Fallback without optional columns
        try:
            sid = execute(
                "INSERT INTO hospital_services(hospital_user_id,name,description,price,duration_minutes,available) VALUES(%s,%s,%s,%s,%s,%s)",
                [hospital_user_id, 'Ambulance', 'Emergency ambulance dispatch', 0, 0, 1]
            )
            return int(sid)
        except Exception:
            # As a last resort, return a synthetic id (not ideal but avoids crash)
            return None

def _ensure_emergency_bed_service(hospital_user_id: int):
    """Ensure an 'Emergency Bed' service exists for a hospital. Returns its id.

    Mirrors _ensure_ambulance_service, but creates a bed/admission style service.
    Idempotent across runs.
    """
    _ensure_hospital_services_tables()
    try:
        row = query("SELECT id FROM hospital_services WHERE hospital_user_id=%s AND LOWER(name) IN ('emergency bed','er admission','emergency admission','bed') ORDER BY id LIMIT 1", [hospital_user_id])
    except Exception:
        row = None
    if row:
        try: return int(row['id'])
        except Exception: return None
    # Create default Emergency Bed service (free, always available, 0 duration)
    try:
        sid = execute(
            "INSERT INTO hospital_services(hospital_user_id,name,description,price,duration_minutes,available,max_per_day,window_start_time,window_end_time) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            [hospital_user_id, 'Emergency Bed', 'Emergency admission bed for crisis patients', 0, 0, 1, None, None, None]
        )
        return int(sid)
    except Exception:
        try:
            sid = execute(
                "INSERT INTO hospital_services(hospital_user_id,name,description,price,duration_minutes,available) VALUES(%s,%s,%s,%s,%s,%s)",
                [hospital_user_id, 'Emergency Bed', 'Emergency admission bed for crisis patients', 0, 0, 1]
            )
            return int(sid)
        except Exception:
            return None
@api_view(require_auth=True, methods=['POST'], csrf=False)
def add_hospital_service(request: HttpRequest, hospital_id: int, _user=None):
    if not (_require_admin(_user) or (_require_hospital(_user) and _user['id']==hospital_id)):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    name = (data.get('name') or '').strip()
    description = data.get('description')
    price = data.get('price') or 0
    duration = int(data.get('duration_minutes') or 30)
    available = 1 if data.get('available', True) else 0
    max_per_day = data.get('max_per_day')
    window_start_time = (data.get('window_start_time') or '').strip() or None
    window_end_time = (data.get('window_end_time') or '').strip() or None
    if not name:
        return JsonResponse({'error':'missing_name'}, status=400)
    # Schema is assumed present from final_normalized_schema.sql
    try:
        if max_per_day is not None:
            max_per_day = int(max_per_day)
            if max_per_day <= 0:
                return JsonResponse({'error':'invalid_max_per_day'}, status=400)
    except Exception:
        return JsonResponse({'error':'invalid_max_per_day'}, status=400)
    # Basic HH:MM sanity for windows if provided
    def _hhmm_ok(t):
        if not t: return True
        try:
            parts = t.split(':')
            return len(parts) >= 2 and 0 <= int(parts[0]) <= 23 and 0 <= int(parts[1]) <= 59
        except Exception:
            return False
    if not _hhmm_ok(window_start_time) or not _hhmm_ok(window_end_time):
        return JsonResponse({'error':'invalid_window_time'}, status=400)
    # Insert with new fields (some DBs accept TIME/strings interchangeably)
    sid = execute(
        "INSERT INTO hospital_services(hospital_user_id,name,description,price,duration_minutes,available,max_per_day,window_start_time,window_end_time) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        [hospital_id, name, description, price, duration, available, max_per_day, window_start_time, window_end_time]
    )
    return JsonResponse({'id': sid})

@api_view(methods=['GET'], csrf=False)
def list_hospital_services(request: HttpRequest, hospital_id: int, _user=None):
    # Ensure an Ambulance service exists so users can request from Services tab
    try:
        _ensure_ambulance_service(hospital_id)
    except Exception:
        pass
    # Ensure an Emergency Bed admission service exists by default
    try:
        _ensure_emergency_bed_service(hospital_id)
    except Exception:
        pass
    rows = query("SELECT id,hospital_user_id,name,description,price,duration_minutes,available,max_per_day,window_start_time,window_end_time FROM hospital_services WHERE hospital_user_id=%s ORDER BY id DESC", [hospital_id], many=True) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def update_hospital_service(request: HttpRequest, hospital_id: int, service_id: int, _user=None):
    """Update fields of a hospital service (owner hospital or admin)."""
    if not (_require_admin(_user) or (_require_hospital(_user) and _user['id']==hospital_id)):
        return JsonResponse({'error':'forbidden'}, status=403)
    # Schema is assumed present from final_normalized_schema.sql
    data = json.loads(request.body or '{}')
    allowed = ['name','description','price','duration_minutes','available','max_per_day','window_start_time','window_end_time']
    sets = []
    params = []
    for k in allowed:
        if k in data:
            if k == 'price':
                try: params.append(float(data[k])); sets.append('price=%s')
                except Exception: return JsonResponse({'error':'invalid_price'}, status=400)
            elif k in ('duration_minutes','max_per_day','available'):
                try: params.append(int(data[k])); sets.append(f"{k}=%s")
                except Exception: return JsonResponse({'error':f'invalid_{k}'}, status=400)
            else:
                params.append(data[k]); sets.append(f"{k}=%s")
    if not sets:
        return JsonResponse({'ok': True})
    params.extend([service_id, hospital_id])
    try:
        execute('UPDATE hospital_services SET ' + ','.join(sets) + ' WHERE id=%s AND hospital_user_id=%s', params)
    except Exception as e:
        return JsonResponse({'error':'update_failed','detail':str(e)}, status=400)
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def delete_hospital_service(request: HttpRequest, hospital_id: int, service_id: int, _user=None):
    """Delete a hospital service (owner hospital or admin)."""
    if not (_require_admin(_user) or (_require_hospital(_user) and _user['id']==hospital_id)):
        return JsonResponse({'error':'forbidden'}, status=403)
    try:
        execute('DELETE FROM hospital_services WHERE id=%s AND hospital_user_id=%s', [service_id, hospital_id])
    except Exception as e:
        return JsonResponse({'error':'delete_failed','detail':str(e)}, status=400)
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def book_service(request: HttpRequest, _user=None):
    # Schema is assumed present from final_normalized_schema.sql
    data = json.loads(request.body or '{}')
    service_id = int(data.get('service_id') or 0)
    hospital_user_id = int(data.get('hospital_user_id') or 0)
    scheduled_at = data.get('scheduled_at')
    notes = _limit_str(data.get('notes') or '', 1000) if data.get('notes') is not None else None
    try:
        lat = float(data.get('lat')) if data.get('lat') is not None else None
    except Exception:
        lat = None
    try:
        lng = float(data.get('lng')) if data.get('lng') is not None else None
    except Exception:
        lng = None
    try:
        crisis_id = int(data.get('crisis_id')) if data.get('crisis_id') is not None else None
    except Exception:
        crisis_id = None
    # If crisis-scoped, block writes when crisis is closed
    if crisis_id:
        ok, err = _require_crisis_open(crisis_id)
        if not ok:
            return err
    if not (service_id and hospital_user_id):
        return JsonResponse({'error':'missing_fields'}, status=400)
    svc = query("SELECT id,hospital_user_id,available,max_per_day,window_start_time,window_end_time,duration_minutes,name FROM hospital_services WHERE id=%s", [service_id])
    if not svc or int(svc['hospital_user_id']) != hospital_user_id:
        return JsonResponse({'error':'service_not_found'}, status=404)
    if int(svc.get('available',1)) != 1:
        return JsonResponse({'error':'service_unavailable'}, status=400)
    # If linked to a crisis, pre-check incident hospital resources capacity (beds) and cache incident row for later decrement
    incident_id_for_crisis = None
    ihr_row = None
    try:
        if crisis_id:
            cr = query("SELECT incident_id FROM crises WHERE id=%s", [crisis_id])
            if cr and cr.get('incident_id'):
                incident_id_for_crisis = int(cr['incident_id'])
                # Only consider bed capacity for non-ambulance services
                _svc_name_lower = str((svc.get('name') or '')).lower()
                if 'ambulance' not in _svc_name_lower:
                    ihr_row = query(
                        "SELECT id,available_beds FROM incident_hospital_resources WHERE incident_id=%s AND hospital_user_id=%s",
                        [incident_id_for_crisis, hospital_user_id]
                    )
                    if ihr_row and ihr_row.get('available_beds') is not None:
                        try:
                            if int(ihr_row['available_beds']) <= 0:
                                return JsonResponse({'error': 'no_beds'}, status=400)
                        except Exception:
                            pass
    except Exception:
        # Best-effort check only; do not block booking on check failure
        pass

    # Determine effective date for per-day checks (ambulance uses today)
    import datetime as _dt
    svc_name_lower = str(svc.get('name') or '').lower()
    effective_when = None
    if 'ambulance' in svc_name_lower:
        effective_when = _dt.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    else:
        # If not provided from crisis flow, default to now for capacity checks
        effective_when = scheduled_at or _dt.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    # One-per-day per user for the same service (booked status)
    try:
        ct_user = None
        try:
            ct_user = query("SELECT COUNT(1) c FROM service_bookings WHERE user_id=%s AND service_id=%s AND DATE(scheduled_at)=DATE(%s) AND status='booked'", [_user['id'], service_id, effective_when])
        except Exception:
            ct_user = query("SELECT COUNT(1) c FROM service_bookings WHERE user_id=? AND service_id=? AND date(scheduled_at)=date(?) AND status='booked'", [_user['id'], service_id, effective_when])
        if int(ct_user.get('c') or 0) > 0:
            return JsonResponse({'error':'one_per_day'}, status=400)
    except Exception:
        pass
    # Enforce max_per_day capacity if set (>0)
    try:
        mpd = int(svc.get('max_per_day') or 0)
    except Exception:
        mpd = 0
    if mpd and mpd > 0:
        # Count bookings for same service and date
        ct = None
        try:
            # MySQL style
            ct = query("SELECT COUNT(1) c FROM service_bookings WHERE service_id=%s AND DATE(scheduled_at)=DATE(%s) AND status='booked'", [service_id, effective_when])
        except Exception:
            try:
                # SQLite style
                ct = query("SELECT COUNT(1) c FROM service_bookings WHERE service_id=? AND date(scheduled_at)=date(?) AND status='booked'", [service_id, effective_when])
            except Exception:
                ct = {'c': 0}
        current = int(ct.get('c') or 0)
        if current >= mpd:
            return JsonResponse({'error':'full'}, status=400)
    # Allocate nearest available slot around the requested time and compute day-level serial (MySQL advisory lock best-effort)
    import datetime as _dt
    serial = None
    approx_time_str = None
    scheduled_to_save = scheduled_at
    # Derive booking date from input
    try:
        # Special-case Ambulance: default to current time and skip slot allocation UI
        svc_name_lower = str(svc.get('name') or '').lower()
        if 'ambulance' in svc_name_lower:
            now = _dt.datetime.utcnow()
            date_part = now.strftime('%Y-%m-%d')
            time_part = now.strftime('%H:%M')
        else:
            # For non-ambulance bookings, allow omitting 'scheduled_at' and default to ASAP today (UTC)
            date_part = None
            time_part = None
            if not scheduled_at:
                now = _dt.datetime.utcnow()
                date_part = now.strftime('%Y-%m-%d')
                time_part = None  # allocator will choose nearest available time within window
            else:
                if isinstance(scheduled_at, str) and len(scheduled_at) >= 10:
                    date_part = scheduled_at[:10]
                if isinstance(scheduled_at, str) and len(scheduled_at) >= 16:
                    time_part = scheduled_at[11:16]
        # If non-ambulance and a booking window is defined, enforce it strictly
        if 'ambulance' not in svc_name_lower:
            try:
                ws = svc.get('window_start_time')
                we = svc.get('window_end_time')
                wstart = str(ws)[:5] if ws else None
                wend = str(we)[:5] if we else None
                def _hhmm_to_min(hhmm):
                    try:
                        h, m = hhmm.split(':')
                        return int(h)*60 + int(m)
                    except Exception:
                        return None
                if wstart and wend and time_part:
                    tmin = _hhmm_to_min(time_part)
                    wmin = _hhmm_to_min(wstart)
                    emin = _hhmm_to_min(wend)
                    if tmin is not None and wmin is not None and emin is not None:
                        if tmin < wmin or tmin > emin:
                            return JsonResponse({'error':'outside_window','window_start': wstart, 'window_end': wend}, status=400)
            except Exception:
                pass

        # Acquire lock if available (MySQL)
        locked = False
        try:
            lock_key = f"svc:{service_id}:{date_part}"
            row = query("SELECT GET_LOCK(%s, 10) AS locked", [lock_key])
            locked = bool(row and int(row.get('locked') or 0) == 1)
        except Exception:
            locked = False

        # Within lock: compute day serial and allocate nearest available slot
        # Day serial is unique per service-date
        # Use the effective date for serial computation (ambulance uses 'now' date)
        day_total = None
        try:
            day_total = query("SELECT COUNT(1) c FROM service_bookings WHERE service_id=%s AND DATE(scheduled_at)=DATE(%s) AND status='booked'", [service_id, (date_part or scheduled_at)])
        except Exception:
            try:
                day_total = query("SELECT COUNT(1) c FROM service_bookings WHERE service_id=? AND date(scheduled_at)=date(?) AND status='booked'", [service_id, (date_part or scheduled_at)])
            except Exception:
                day_total = {'c': 0}
        serial = int(day_total.get('c') or 0) + 1

        # Build set of taken HH:MM for that date
        existing = []
        try:
            existing = query("SELECT TIME(scheduled_at) t FROM service_bookings WHERE service_id=%s AND DATE(scheduled_at)=DATE(%s) AND status='booked'", [service_id, (date_part or scheduled_at)], many=True) or []
        except Exception:
            try:
                existing = query("SELECT time(scheduled_at) t FROM service_bookings WHERE service_id=? AND date(scheduled_at)=date(?) AND status='booked'", [service_id, (date_part or scheduled_at)], many=True) or []
            except Exception:
                existing = []
        taken = set()
        for r in existing:
            try:
                tval = r.get('t') if isinstance(r, dict) else None
                if tval is not None:
                    taken.add(str(tval)[:5])
            except Exception:
                continue

        # Window bounds
        ws = svc.get('window_start_time')
        we = svc.get('window_end_time')
        wstart = str(ws)[:5] if ws else None
        wend = str(we)[:5] if we else None
        try:
            step = int(svc.get('duration_minutes') or 30)
        except Exception:
            step = 30

        def hhmm_to_min(hhmm):
            try:
                h, m = hhmm.split(':')
                return int(h)*60 + int(m)
            except Exception:
                return None
        def min_to_hhmm(minutes):
            minutes %= (24*60)
            h = minutes // 60
            m = minutes % 60
            return f"{h:02d}:{m:02d}"

        desired = time_part or (wstart or '09:00')
        desired_min = hhmm_to_min(desired)
        wstart_min = hhmm_to_min(wstart) if wstart else 0
        wend_min = hhmm_to_min(wend) if wend else (23*60+59)
        if desired_min is not None:
            if desired_min < wstart_min: desired_min = wstart_min
            if desired_min > wend_min: desired_min = wend_min

        found = None
        if 'ambulance' in svc_name_lower:
            # Use near-future time so it appears under Upcoming for the user
            now = _dt.datetime.utcnow()
            eta = now + _dt.timedelta(minutes=15)
            approx_time_str = eta.strftime('%H:%M')
            scheduled_to_save = eta.strftime('%Y-%m-%d %H:%M:%S')
        else:
            # Search nearest available: desired, then +step, -step, +2*step, -2*step, ... within window
            max_iters = max(1, ((wend_min - wstart_min) // max(1, step)))
            for i in range(0, max_iters+1):
                for sign in ([0] if i == 0 else [+1, -1]):
                    cm = desired_min + sign * i * step
                    if cm < wstart_min or cm > wend_min:
                        continue
                    hhmm = min_to_hhmm(cm)
                    if hhmm not in taken:
                        found = hhmm
                        taken.add(hhmm)
                        break
                if found is not None:
                    break
            if found is None:
                return JsonResponse({'error':'full'}, status=400)

            # Finalize allocated time
            try:
                dparts = [int(x) for x in (date_part or '1970-01-01').split('-')]
                tparts = [int(x) for x in found.split(':')]
                base = _dt.datetime(dparts[0], dparts[1], dparts[2], tparts[0], tparts[1], 0)
            except Exception:
                base = _dt.datetime.utcnow()
            approx_dt = base
            approx_time_str = approx_dt.strftime('%H:%M')
            scheduled_to_save = approx_dt.strftime('%Y-%m-%d %H:%M:%S')
    finally:
        try:
            if 'lock_key' in locals():
                query("SELECT RELEASE_LOCK(%s) AS released", [lock_key])
        except Exception:
            pass

    # Insert with optional notes/coords and crisis linkage (final schema has all columns)
    bid = execute("INSERT INTO service_bookings(user_id,hospital_user_id,service_id,scheduled_at,status,serial,approx_time,notes,lat,lng,crisis_id) VALUES(%s,%s,%s,%s,'booked',%s,%s,%s,%s,%s,%s)", [_user['id'], hospital_user_id, service_id, scheduled_to_save, serial, approx_time_str, notes, lat, lng, crisis_id])

    # Note: Bed capacity is NOT decremented at booking time. We only pre-check here to block
    # creating a booking when available_beds is 0. Actual decrement happens on hospital confirm.
    # best-effort notify hospital owner
    try:
        _notify(hospital_user_id, 'service_booked', {'booking_id': bid, 'service_id': service_id})
    except Exception:
        pass
    # Notify patient as confirmation (especially important in crisis flow)
    try:
        payload = {'booking_id': bid, 'service_id': service_id}
        if crisis_id:
            payload['crisis_id'] = crisis_id
        if approx_time_str:
            payload['approx_time'] = approx_time_str
        if scheduled_to_save:
            payload['scheduled_at'] = scheduled_to_save
        _notify(_user['id'], 'service_booking_confirmed', payload)
    except Exception:
        pass

    # If this is the Ambulance service, auto-create a direct message to the hospital owner with details.
    try:
        svc_name = (svc.get('name') or '').lower()
    except Exception:
        svc_name = ''
    if 'ambulance' in svc_name:
        try:
            # Reuse 1:1 conversation if exists; else create it
            existing = query(
                """
                SELECT c.id FROM conversations c
                JOIN conversation_participants p1 ON p1.conversation_id=c.id AND p1.user_id=%s
                JOIN conversation_participants p2 ON p2.conversation_id=c.id AND p2.user_id=%s
                WHERE c.is_group=0
                LIMIT 1
                """, [_user['id'], hospital_user_id]
            )
            if existing:
                cid = existing['id']
            else:
                cid = execute("INSERT INTO conversations(is_group, created_by_user_id) VALUES(0,%s)", [_user['id']])
                execute("INSERT INTO conversation_participants(conversation_id,user_id) VALUES(%s,%s)", [cid, _user['id']])
                execute("INSERT INTO conversation_participants(conversation_id,user_id) VALUES(%s,%s)", [cid, hospital_user_id])
            # Compose message
            parts = []
            parts.append(f"Ambulance requested (booking #{bid}).")
            if notes:
                parts.append(f"Details: {notes}")
            if lat is not None and lng is not None:
                parts.append(f"Location: {lat:.6f}, {lng:.6f}")
            body = " \n".join(parts)
            mid = execute("INSERT INTO messages(conversation_id,sender_user_id,body) VALUES(%s,%s,%s)", [cid, _user['id'], body])
            try:
                _notify(hospital_user_id, 'message_new', {'conversation_id': cid, 'message_id': mid})
            except Exception:
                pass
        except Exception:
            pass
    return JsonResponse({'id': bid, 'serial': serial, 'approx_time': approx_time_str, 'scheduled_at': scheduled_to_save})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_my_service_bookings(request: HttpRequest, _user=None):
    # Schema is assumed present from final_normalized_schema.sql
    # Try enriched response with joins + hidden filter; add hidden column if missing
    params = [_user['id']]
    crisis_id = (request.GET.get('crisis_id') or '').strip()
    where_extra = ""
    # Optional crisis scoping: when provided, only return bookings tied to this crisis
    if crisis_id.isdigit():
        where_extra = " AND sb.crisis_id=%s"
        params.append(int(crisis_id))
    sql = (
        f"""
        SELECT sb.*,
               hs.name AS service_name,
               hs.duration_minutes AS service_duration_minutes,
               h.id AS hospital_id,
               COALESCE(h.name, hu.full_name) AS hospital_name
        FROM service_bookings sb
        JOIN hospital_services hs ON hs.id = sb.service_id
        LEFT JOIN hospitals h ON h.user_id = sb.hospital_user_id
        LEFT JOIN users hu ON hu.id = sb.hospital_user_id
        WHERE sb.user_id=%s AND COALESCE(sb.hidden_by_user,0)=0{where_extra}
        ORDER BY sb.scheduled_at DESC
        """
    )
    rows = query(sql, params, many=True) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_hospital_service_bookings(request: HttpRequest, _user=None):
    """Hospital owner: list service bookings for my hospital account."""
    if not _require_hospital(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_hospital_services_tables()
    rows = query(
        """
        SELECT sb.*,
               hs.name AS service_name,
               u.full_name AS user_name,
               u.avatar_url AS user_avatar_url
        FROM service_bookings sb
        JOIN hospital_services hs ON hs.id = sb.service_id
        JOIN users u ON u.id = sb.user_id
        WHERE sb.hospital_user_id=%s
        ORDER BY sb.scheduled_at DESC
        """,
        [_user['id']], many=True
    ) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def request_cancel_service_booking(request: HttpRequest, booking_id: int, _user=None):
    """Patient cancels a booked service (no approval), must be at least 2 hours prior."""
    sb = query("SELECT * FROM service_bookings WHERE id=%s", [booking_id])
    if not sb:
        return JsonResponse({'error':'not_found'}, status=404)
    if int(sb.get('user_id')) != int(_user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    if sb.get('status') != 'booked':
        return JsonResponse({'error':'invalid_status'}, status=400)
    import datetime as _dt
    try:
        now = _dt.datetime.utcnow()
        st = _dt.datetime.fromisoformat(str(sb.get('scheduled_at')).replace('Z','+00:00'))
        if (st - now).total_seconds() < 2*3600:
            return JsonResponse({'error':'too_late_to_cancel'}, status=400)
    except Exception:
        return JsonResponse({'error':'invalid_time'}, status=400)
    execute("UPDATE service_bookings SET status='cancelled' WHERE id=%s AND user_id=%s AND status='booked'", [booking_id, _user['id']])
    # No bed restoration here since beds are now decremented only upon hospital confirmation.
    # Notify both parties (best-effort)
    try:
        _notify(int(sb['hospital_user_id']), 'service_booking_cancelled', {'booking_id': booking_id})
    except Exception:
        pass
    try:
        _notify(_user['id'], 'service_booking_cancelled', {'booking_id': booking_id})
    except Exception:
        pass
    return JsonResponse({'ok': True, 'status': 'cancelled'})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def approve_cancel_service_booking(request: HttpRequest, booking_id: int, _user=None):
    return JsonResponse({'error':'not_supported'}, status=400)

@api_view(require_auth=True, methods=['POST'], csrf=False)
def decline_cancel_service_booking(request: HttpRequest, booking_id: int, _user=None):
    return JsonResponse({'error':'not_supported'}, status=400)

@api_view(require_auth=True, methods=['POST'], csrf=False)
def confirm_service_booking(request: HttpRequest, booking_id: int, _user=None):
    """Hospital owner confirms a patient's service booking (booked -> confirmed).
    Only the owning hospital user (or admin) may perform this action.
    """
    sb = query("SELECT * FROM service_bookings WHERE id=%s", [booking_id])
    if not sb:
        return JsonResponse({'error':'not_found'}, status=404)
    is_owner = int(sb.get('hospital_user_id', 0)) == int(_user['id'])
    if not (_require_admin(_user) or (_require_hospital(_user) and is_owner)):
        return JsonResponse({'error':'forbidden'}, status=403)
    if sb.get('status') not in ('booked',):
        return JsonResponse({'error':'invalid_status'}, status=400)
    # If crisis-linked and non-ambulance, ensure capacity exists and decrement 1
    try:
        if sb.get('crisis_id'):
            cr = query("SELECT incident_id FROM crises WHERE id=%s", [sb['crisis_id']])
            ok, err = _require_crisis_open(int(sb['crisis_id']))
            if not ok:
                return err
            svc_for_confirm = query("SELECT name FROM hospital_services WHERE id=%s", [sb['service_id']]) or {}
            is_ambulance = 'ambulance' in str((svc_for_confirm.get('name') or '')).lower()
            if cr and cr.get('incident_id') and not is_ambulance:
                ihr = query(
                    "SELECT id,available_beds FROM incident_hospital_resources WHERE incident_id=%s AND hospital_user_id=%s",
                    [cr['incident_id'], sb['hospital_user_id']]
                )
                if ihr and ihr.get('available_beds') is not None:
                    try:
                        if int(ihr['available_beds']) <= 0:
                            return JsonResponse({'error':'no_beds'}, status=400)
                    except Exception:
                        pass
                # Decrement now that we're confirming
                try:
                    execute(
                        "UPDATE incident_hospital_resources SET available_beds=CASE WHEN COALESCE(available_beds,0)-1 < 0 THEN 0 ELSE COALESCE(available_beds,0)-1 END, updated_at=CURRENT_TIMESTAMP WHERE id=%s",
                        [ihr['id']]
                    )
                except Exception:
                    pass
    except Exception:
        pass
    try:
        execute("UPDATE service_bookings SET status='confirmed' WHERE id=%s AND status='booked'", [booking_id])
    except Exception as e:
        return JsonResponse({'error':'update_failed','detail':str(e)}, status=400)
    # Notify patient of confirmation
    try:
        _notify(int(sb['user_id']), 'service_booking_confirmed_by_hospital', {'booking_id': booking_id})
    except Exception:
        pass
    # Incident event log (if crisis-linked)
    try:
        if sb.get('crisis_id'):
            cr = query("SELECT incident_id FROM crises WHERE id=%s", [sb['crisis_id']])
            if cr and cr.get('incident_id'):
                execute(
                    "INSERT INTO incident_events(incident_id,user_id,event_type,note) VALUES(%s,%s,'note',%s)",
                    [cr['incident_id'], _user['id'], f"[Hospital Resources] Reserved 1 bed by confirming booking #{booking_id}"]
                )
    except Exception:
        pass
    return JsonResponse({'ok': True, 'status': 'confirmed'})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def decline_service_booking(request: HttpRequest, booking_id: int, _user=None):
    """Hospital owner declines a patient's service booking (booked -> declined).
    Restores crisis bed capacity for non-ambulance services when applicable.
    """
    sb = query("SELECT * FROM service_bookings WHERE id=%s", [booking_id])
    if not sb:
        return JsonResponse({'error':'not_found'}, status=404)
    is_owner = int(sb.get('hospital_user_id', 0)) == int(_user['id'])
    if not (_require_admin(_user) or (_require_hospital(_user) and is_owner)):
        return JsonResponse({'error':'forbidden'}, status=403)
    if sb.get('status') not in ('booked',):
        return JsonResponse({'error':'invalid_status'}, status=400)
    try:
        execute("UPDATE service_bookings SET status='declined' WHERE id=%s AND status='booked'", [booking_id])
    except Exception as e:
        return JsonResponse({'error':'update_failed','detail':str(e)}, status=400)
    # No bed restoration on decline since beds are decremented only on confirm.
    try:
        if sb.get('crisis_id'):
            cr = query("SELECT incident_id FROM crises WHERE id=%s", [sb['crisis_id']])
            ok, err = _require_crisis_open(int(sb['crisis_id']))
            if not ok:
                return err
            if cr and cr.get('incident_id'):
                try:
                    execute(
                        "INSERT INTO incident_events(incident_id,user_id,event_type,note) VALUES(%s,%s,'note',%s)",
                        [cr['incident_id'], _user['id'], f"[Hospital Booking] Declined booking #{booking_id}"]
                    )
                except Exception:
                    pass
    except Exception:
        pass
    # Notify both parties
    try:
        _notify(int(sb['user_id']), 'service_booking_declined', {'booking_id': booking_id})
    except Exception:
        pass
    try:
        _notify(int(sb['hospital_user_id']), 'service_booking_declined', {'booking_id': booking_id})
    except Exception:
        pass
    return JsonResponse({'ok': True, 'status': 'declined'})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def hide_service_booking(request: HttpRequest, booking_id: int, _user=None):
    """Patient hides a service booking from their view (soft delete)."""
    sb = query("SELECT * FROM service_bookings WHERE id=%s", [booking_id])
    if not sb:
        return JsonResponse({'error':'not_found'}, status=404)
    if int(sb.get('user_id')) != int(_user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    try:
        execute("UPDATE service_bookings SET hidden_by_user=1 WHERE id=%s AND user_id=%s", [booking_id, _user['id']])
    except Exception as e:
        return JsonResponse({'error':'hide_failed','detail':str(e)}, status=400)
    return JsonResponse({'ok': True})

# --- Read-only entity detail endpoints ---------------------------------------

@api_view(methods=['GET'], csrf=False)
def get_user_public(request: HttpRequest, user_id: int, _user=None):
    # Try to include bio/avatar_url if columns exist; fall back otherwise.
    u = query("SELECT id,email,full_name,role,status,created_at,bio,avatar_url FROM users WHERE id=%s", [user_id])
    try:
        posts_ct = query("SELECT COUNT(1) c FROM posts WHERE author_id=%s", [user_id]) or {'c':0}
    except Exception:
        posts_ct = {'c': 0}
    # Follower/following counts (if table exists)
    followers = 0
    following = 0
    is_following = False
    try:
        fc = query("SELECT COUNT(1) c FROM user_follows WHERE followee_user_id=%s", [user_id]) or {'c':0}
        followers = int(fc.get('c') or 0)
        fg = query("SELECT COUNT(1) c FROM user_follows WHERE follower_user_id=%s", [user_id]) or {'c':0}
        following = int(fg.get('c') or 0)
        if _user:
            chk = query("SELECT 1 FROM user_follows WHERE follower_user_id=%s AND followee_user_id=%s", [_user['id'], user_id])
            is_following = bool(chk)
    except Exception:
        pass
    u['post_count'] = int(posts_ct.get('c') or 0)
    u['followers'] = followers
    u['following'] = following
    if _user:
        u['is_following'] = is_following
    return JsonResponse(u)

@api_view(require_auth=True, methods=['POST'], csrf=False)
def update_current_user(request: HttpRequest, _user=None):
    """Update current user's profile (bio, avatar_url).

    Body: { bio?, avatar_url? }
    Adds columns if missing (bio TEXT, avatar_url TEXT) for dev convenience.
    """
    data = json.loads(request.body or '{}')
    bio = data.get('bio')
    avatar_url = data.get('avatar_url')
    # Columns exist per final schema
    sets = []
    params = []
    if bio is not None:
        sets.append('bio=%s'); params.append(_limit_str(bio, 2000))
    if avatar_url is not None:
        sets.append('avatar_url=%s'); params.append(_limit_str(avatar_url, 2048))
    if sets:
        params.append(_user['id'])
        try:
            execute('UPDATE users SET ' + ','.join(sets) + ' WHERE id=%s', params)
        except Exception as e:
            return JsonResponse({'error':'update_failed','detail':str(e)}, status=400)
    # Return updated public profile
    u = query("SELECT id,email,full_name,role,status,created_at,bio,avatar_url FROM users WHERE id=%s", [_user['id']])
    return JsonResponse(u or {'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def follow_user(request: HttpRequest, user_id: int, _user=None):
    if int(user_id) == _user['id']:
        return JsonResponse({'error': 'cannot_follow_self'}, status=400)
    # Ensure target exists
    tgt = query("SELECT id FROM users WHERE id=%s", [user_id])
    if not tgt:
        return JsonResponse({'error': 'not_found'}, status=404)
    # Idempotent follow
    ex = query("SELECT 1 FROM user_follows WHERE follower_user_id=%s AND followee_user_id=%s", [_user['id'], user_id])
    if not ex:
        try:
            execute("INSERT INTO user_follows(follower_user_id, followee_user_id) VALUES(%s,%s)", [_user['id'], user_id])
        except Exception:
            pass
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def unfollow_user(request: HttpRequest, user_id: int, _user=None):
    if int(user_id) == _user['id']:
        return JsonResponse({'error': 'cannot_unfollow_self'}, status=400)
    # Ensure target exists (optional soft check)
    tgt = query("SELECT id FROM users WHERE id=%s", [user_id])
    if not tgt:
        return JsonResponse({'error': 'not_found'}, status=404)
    try:
        execute("DELETE FROM user_follows WHERE follower_user_id=%s AND followee_user_id=%s", [_user['id'], user_id])
    except Exception:
        pass
    return JsonResponse({'ok': True})

@api_view(methods=['GET'], csrf=False)
def get_hospital_by_user(request: HttpRequest, user_id: int, _user=None):
    # Fetch hospital by owning user id; if absent, auto-create a minimal record.
    try:
        h = query("SELECT id,user_id,name,address FROM hospitals WHERE user_id=%s", [user_id])
    except Exception:
        h = None
    if not h:
        # Attempt to auto-create hospital record for this user (idempotent style)
        try:
            u = query("SELECT id,email,full_name FROM users WHERE id=%s", [user_id])
        except Exception:
            u = None
        if not u:
            return JsonResponse({'error':'not_found'}, status=404)
        # Derive a friendly default name
        name = (u.get('full_name') or '')
        if not name:
            em = (u.get('email') or '').split('@')[0]
            name = (em.replace('.', ' ').title() + ' hospital').strip() or f"Hospital #{user_id}"
        try:
            execute("INSERT INTO hospitals(user_id,name,address) VALUES(%s,%s,%s)", [user_id, name, None])
        except Exception:
            # Table may be SQLite; None works for address, ignore duplicate errors
            pass
        # Re-read after insert (or if insert failed due to dup, it will be present)
        try:
            h = query("SELECT id,user_id,name,address FROM hospitals WHERE user_id=%s", [user_id])
        except Exception:
            h = None
        if not h:
            return JsonResponse({'error':'not_found'}, status=404)
    try:
        doc_ct = query("SELECT COUNT(1) c FROM hospital_doctors WHERE hospital_user_id=%s", [user_id]) or {'c':0}
    except Exception:
        doc_ct = {'c':0}
    h['doctor_count'] = int(doc_ct.get('c') or 0)
    return JsonResponse(h)

@api_view(methods=['GET'], csrf=False)
def get_hospital(request: HttpRequest, hospital_id: int, _user=None):
    """Get hospital by canonical id.

    Returns: { id, user_id, name, address, doctor_count }
    """
    try:
        h = query("SELECT id,user_id,name,address FROM hospitals WHERE id=%s", [hospital_id])
    except Exception:
        h = None
    if not h:
        return JsonResponse({'error': 'not_found'}, status=404)
    try:
        doc_ct = query("SELECT COUNT(1) c FROM hospital_doctors WHERE hospital_user_id=%s", [h.get('user_id')]) or {'c': 0}
    except Exception:
        doc_ct = {'c': 0}
    h['doctor_count'] = int(doc_ct.get('c') or 0)
    return JsonResponse(h)

@api_view(methods=['GET'], csrf=False)
def get_doctor(request: HttpRequest, doctor_id: int, _user=None):
    """Fetch a doctor's profile.

    Backward-compatible: supports either the canonical doctors.id OR the doctor's
    user id (doctor_user_id). This matches how the frontend links from the
    hospital page, which currently uses user ids.
    """
    d = None
    # 1) Try canonical doctors.id
    try:
        d = query("SELECT id,user_id,name,specialty FROM doctors WHERE id=%s", [doctor_id])
    except Exception:
        d = None
    # 2) Fallback: treat param as doctor_user_id
    if not d:
        try:
            d = query("SELECT id,user_id,name,specialty FROM doctors WHERE user_id=%s", [doctor_id])
        except Exception:
            d = None
    # 3) If still not found, synthesize a minimal profile from users table so
    #    doctor pages can render even before a doctor profile row is created.
    if not d:
        try:
            u = query("SELECT id,email,full_name FROM users WHERE id=%s", [doctor_id])
        except Exception:
            u = None
        if not u:
            return JsonResponse({'error': 'not_found'}, status=404)
        # Derive a display name if full_name is missing
        name = (u.get('full_name') or '').strip()
        if not name:
            em = (u.get('email') or '').split('@')[0]
            name = (em.replace('.', ' ').title() or f"Doctor #{u['id']}")
        d = {
            # id is the doctors.id; unknown when not present. Omit it.
            'user_id': u['id'],
            'name': name,
            'specialty': None,
        }
    # Attach basic user info if present
    try:
        uid = d.get('user_id') if isinstance(d, dict) else None
        if uid is not None:
            u = query("SELECT id,email,full_name FROM users WHERE id=%s", [uid])
            if u:
                d['user'] = {'id': u['id'], 'email': u['email'], 'full_name': u['full_name']}
    except Exception:
        pass
    return JsonResponse(d)

@api_view(methods=['GET'], csrf=False)
def get_fire_department(request: HttpRequest, department_id: int, _user=None):
    try:
        fd = query("SELECT id,user_id,name,lat,lng FROM fire_departments WHERE id=%s", [department_id])
    except Exception:
        fd = None
    if not fd:
        return JsonResponse({'error':'not_found'}, status=404)
    return JsonResponse(fd)

@api_view(methods=['GET'], csrf=False)
def get_fire_request(request: HttpRequest, request_id: int, _user=None):
    try:
        fr = query("SELECT * FROM fire_service_requests WHERE id=%s", [request_id])
    except Exception:
        fr = None
    if not fr:
        return JsonResponse({'error':'not_found'}, status=404)
    return JsonResponse(fr)

@api_view(methods=['GET'], csrf=False)
def list_user_posts(request: HttpRequest, user_id: int, _user=None):
    """Public list of recent posts authored by a user.

    Query params: optional `limit` (default 20, max 100)
    Returns: { results: [ { id, body, image_url, created_at } ] }
    """
    # sanitize limit
    lim = request.GET.get('limit')
    try:
        lim = int(lim) if lim is not None else 20
    except Exception:
        lim = 20
    if lim <= 0: lim = 20
    if lim > 100: lim = 100
    rows = query("SELECT id, body, image_url, created_at FROM posts WHERE author_id=%s ORDER BY id DESC LIMIT %s", [user_id, lim], many=True) or []
    return JsonResponse({'results': rows})

@api_view(methods=['GET'], csrf=False)
def list_user_activity(request: HttpRequest, user_id: int, _user=None):
    """Return combined list of user's authored posts, their shares, and operational activity.

    Adds best-effort aggregates (tables may be missing):
      - Fire missions: requests assigned to user's department (owner) or where user is staff of assigned dept
      - Appointments: as patient or doctor

        Returns: { items: [ { type, id, created_at, ... } ] }
    Types:
      - 'post': { id, body, image_url? }
      - 'share': { id, post_id, comment }
            - 'fire_request': { id, status, description, org_type: 'fire_department', org_id: <department_id> }
            - 'appointment': { id, role: 'patient'|'doctor', starts_at, ends_at, status, org_type: 'hospital', org_id: <hospital_user_id> }
    """
    posts = query("SELECT id, body, image_url, created_at FROM posts WHERE author_id=%s", [user_id], many=True) or []
    try:
        shares = query("SELECT id, post_id, comment, created_at FROM post_shares WHERE user_id=%s", [user_id], many=True) or []
    except Exception:
        shares = []
    items = [
        { 'type': 'post', 'id': p['id'], 'body': p.get('body'), 'image_url': p.get('image_url'), 'created_at': p.get('created_at') }
        for p in posts
    ] + [
        { 'type': 'share', 'id': s['id'], 'post_id': s.get('post_id'), 'comment': s.get('comment'), 'created_at': s.get('created_at') }
        for s in shares
    ]
    # Fire missions
    try:
        # Owner department
        dept = query('SELECT id FROM fire_departments WHERE user_id=%s LIMIT 1', [user_id])
        dept_id = dept['id'] if dept else None
        # Staff departments
        staff_depts = []
        try:
            staff_rows = query('SELECT department_id FROM fire_staff WHERE user_id=%s', [user_id], many=True) or []
            staff_depts = [r['department_id'] for r in staff_rows if r and r.get('department_id') is not None]
        except Exception:
            staff_depts = []
        dept_ids = []
        if dept_id:
            dept_ids.append(dept_id)
        dept_ids.extend([d for d in staff_depts if d not in dept_ids])
        if dept_ids:
            placeholders = ','.join(['%s'] * len(dept_ids))
            frs = query(
                f"SELECT id, description, status, created_at, assigned_department_id FROM fire_service_requests WHERE assigned_department_id IN ({placeholders})",
                dept_ids, many=True
            ) or []
            for r in frs:
                items.append({
                    'type': 'fire_request',
                    'id': r['id'],
                    'status': r.get('status'),
                    'description': r.get('description'),
                    'created_at': r.get('created_at'),
                    'org_type': 'fire_department',
                    'org_id': r.get('assigned_department_id'),
                })
    except Exception:
        pass
    # Appointments (patient)
    try:
        ap = query("SELECT id, starts_at, ends_at, status, created_at, hospital_user_id FROM appointments WHERE patient_user_id=%s", [user_id], many=True) or []
        for r in ap:
            items.append({
                'type': 'appointment',
                'id': r['id'],
                'role': 'patient',
                'starts_at': r.get('starts_at'),
                'ends_at': r.get('ends_at'),
                'status': r.get('status'),
                'created_at': r.get('created_at'),
                'org_type': 'hospital',
                'org_id': r.get('hospital_user_id'),
            })
    except Exception:
        pass
    # Appointments (doctor)
    try:
        apd = query("SELECT id, starts_at, ends_at, status, created_at, hospital_user_id FROM appointments WHERE doctor_user_id=%s", [user_id], many=True) or []
        for r in apd:
            items.append({
                'type': 'appointment',
                'id': r['id'],
                'role': 'doctor',
                'starts_at': r.get('starts_at'),
                'ends_at': r.get('ends_at'),
                'status': r.get('status'),
                'created_at': r.get('created_at'),
                'org_type': 'hospital',
                'org_id': r.get('hospital_user_id'),
            })
    except Exception:
        pass
    # Sort by created_at desc; tolerate missing/invalid values
    try:
        items.sort(key=lambda x: x.get('created_at') or '', reverse=True)
    except Exception:
        pass
    return JsonResponse({'items': items})

@api_view(methods=['GET'], csrf=False)
def list_user_organizations(request: HttpRequest, user_id: int, _user=None):
    """Aggregate all organizations the user is involved with.

    Sources (best-effort, tables may be absent):
      - Fire department they own (if role fire_service created one)
      - Hospitals where they're recorded as a doctor (hospital_doctors)
      - Active campaigns they participate in (campaign_participants accepted)
      - Social organizations they created (social_organizations)
    """
    items = []
    seen = set()
    # Fire department they own
    try:
        fd = query("SELECT id, name FROM fire_departments WHERE user_id=%s", [user_id], many=True) or []
        for r in fd:
            key = ('fire_department', r['id'])
            if key not in seen:
                seen.add(key)
                items.append({'type': 'fire_department', 'id': r['id'], 'name': r.get('name')})
    except Exception:
        pass
    # Fire department where user is staff
    try:
        fds = query(
            """
            SELECT d.id, d.name
            FROM fire_staff s
            JOIN fire_departments d ON d.id = s.department_id
            WHERE s.user_id=%s
            ORDER BY s.created_at DESC
            """,
            [user_id], many=True
        ) or []
        for r in fds:
            key = ('fire_department', r['id'])
            if key not in seen:
                seen.add(key)
                items.append({'type': 'fire_department', 'id': r['id'], 'name': r.get('name')})
    except Exception:
        pass
    # Hospital memberships (doctor)
    try:
        hs = query(
            """
            SELECT h.id, h.full_name AS name
            FROM hospital_doctors hd
            JOIN users h ON h.id = hd.hospital_user_id
            WHERE hd.doctor_user_id=%s
            """,
            [user_id], many=True
        ) or []
        for r in hs:
            key = ('hospital', r['id'])
            if key not in seen:
                seen.add(key)
                items.append({'type': 'hospital', 'id': r['id'], 'name': r.get('name')})
    except Exception:
        pass
    # Blood bank affiliations
    # 1) If this user IS a blood bank owner/account, include their own bank
    try:
        urow = query("SELECT role, full_name FROM users WHERE id=%s", [user_id])
        if urow and (urow.get('role') == 'blood_bank'):
            key = ('blood_bank', user_id)
            if key not in seen:
                seen.add(key)
                items.append({'type': 'blood_bank', 'id': user_id, 'name': urow.get('full_name') or 'Blood Bank'})
    except Exception:
        pass
    # 2) Banks where this user is registered as a donor
    try:
        donor_banks = query(
            """
            SELECT d.bank_user_id AS id, u.full_name AS name
            FROM blood_bank_donors d
            LEFT JOIN users u ON u.id = d.bank_user_id
            WHERE d.user_id=%s
            ORDER BY u.full_name, d.bank_user_id
            """,
            [user_id], many=True
        ) or []
        for r in donor_banks:
            bid = r.get('id')
            if not bid:
                continue
            key = ('blood_bank', bid)
            if key not in seen:
                seen.add(key)
                name = r.get('name') or f"Blood Bank {bid}"
                items.append({'type': 'blood_bank', 'id': bid, 'name': name})
    except Exception:
        pass
    # Campaign participations (accepted)
    try:
        cps = query(
            """
            SELECT c.id, c.title AS name
            FROM campaign_participants cp
            JOIN campaigns c ON c.id = cp.campaign_id
            WHERE cp.user_id=%s AND (cp.status='accepted' OR cp.status IS NULL)
            ORDER BY cp.joined_at DESC
            """,
            [user_id], many=True
        ) or []
        for r in cps:
            key = ('campaign', r['id'])
            if key not in seen:
                seen.add(key)
                items.append({'type': 'campaign', 'id': r['id'], 'name': r.get('name')})
    except Exception:
        pass
    # Social organizations authored
    try:
        so = query("SELECT id, name FROM social_organizations WHERE user_id=%s ORDER BY name ASC", [user_id], many=True) or []
        for r in so:
            key = ('social_organization', r['id'])
            if key not in seen:
                seen.add(key)
                items.append({'type': 'social_organization', 'id': r['id'], 'name': r.get('name')})
    except Exception:
        pass
    return JsonResponse({'items': items})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def book_appointment(request: HttpRequest, _user=None):
    """Patient books an appointment with a doctor at a hospital.

    Body: { doctor_user_id, hospital_user_id, starts_at (ISO), ends_at (ISO) }
    """
    data = json.loads(request.body or '{}')
    doctor_id = int(data.get('doctor_user_id') or 0)
    hospital_id = int(data.get('hospital_user_id') or 0)
    starts_at = data.get('starts_at')
    ends_at = data.get('ends_at')
    if not (doctor_id and hospital_id and starts_at and ends_at):
        return JsonResponse({'error':'missing_fields'}, status=400)
    # membership
    mem = query("SELECT 1 FROM hospital_doctors WHERE hospital_user_id=%s AND doctor_user_id=%s", [hospital_id, doctor_id])
    if not mem:
        return JsonResponse({'error':'not_member'}, status=400)
    # Columns serial and approx_time are defined in the final schema.
    # Determine weekday and find matching schedule for capacity and duration
    try:
        import datetime as _dt
        dt = _dt.datetime.fromisoformat(starts_at.replace('Z','+00:00'))
    except Exception:
        dt = None
    weekday = dt.weekday() if dt else None  # Monday=0..Sunday=6; our API uses 0=Sunday, so adjust
    if weekday is not None:
        weekday = (weekday + 1) % 7
    # Fetch all schedule blocks for that weekday (doctor+hospital)
    schedules = []
    if weekday is not None:
        try:
            schedules = query(
                "SELECT id, start_time, end_time, visit_cost, max_per_day FROM doctor_schedules WHERE doctor_user_id=%s AND hospital_user_id=%s AND weekday=%s ORDER BY start_time ASC",
                [doctor_id, hospital_id, weekday], many=True
            ) or []
        except Exception:
            schedules = []
    # Quick rejection if no schedules on that day
    if not schedules:
        return JsonResponse({'error': 'no_schedule'}, status=400)
    # Extract HH:MM from ISO timestamps
    def _hhmm(iso):
        try:
            t = iso[11:16]
            # normalize to HH:MM
            if len(t) == 5 and t[2] == ':':
                return t
        except Exception:
            pass
        return None
    st_hm = _hhmm(starts_at)
    en_hm = _hhmm(ends_at)
    if not st_hm or not en_hm:
        return JsonResponse({'error':'invalid_time'}, status=400)
    if st_hm >= en_hm:
        return JsonResponse({'error':'invalid_range'}, status=400)
    # Ensure selected times fall entirely within one published block
    inside_block = False
    for s in schedules:
        s_start = str(s.get('start_time'))[:5]
        s_end = str(s.get('end_time'))[:5]
        if s_start <= st_hm and en_hm <= s_end:
            inside_block = True
            break
    if not inside_block:
        return JsonResponse({'error':'outside_schedule'}, status=400)
    # Capacity: sum per-day max across blocks (ignore nulls/zeros)
    try:
        max_per_day = sum(int(x.get('max_per_day') or 0) for x in schedules)
    except Exception:
        max_per_day = 0
    # capacity check for that doctor/hospital/day
    day_start = starts_at[:10] + ' 00:00:00'
    day_end = starts_at[:10] + ' 23:59:59'
    # Enforce single appointment per patient with same doctor per day
    existing_same_day = query(
        "SELECT id FROM appointments WHERE patient_user_id=%s AND doctor_user_id=%s AND hospital_user_id=%s AND starts_at BETWEEN %s AND %s LIMIT 1",
        [_user['id'], doctor_id, hospital_id, day_start, day_end]
    )
    if existing_same_day:
        return JsonResponse({'error': 'already_booked_same_day'}, status=400)

    # Concurrency control: for MySQL use advisory lock around capacity + serial + insert
    serial = None
    approx_time = None
    from django.db import connection as _c
    engine = str(_c.settings_dict.get('ENGINE','')).lower()
    lock_key = f"appointments:{doctor_id}:{hospital_id}:{starts_at[:10]}"
    got_lock = False
    try:
        if 'mysql' in engine:
            try:
                row = query("SELECT GET_LOCK(%s, 10) AS locked", [lock_key])
                got_lock = bool(row and int(row.get('locked', 0)) == 1)
            except Exception:
                got_lock = False
        # capacity/serial within lock (or best-effort without it)
        day_count = query("SELECT COUNT(*) c FROM appointments WHERE doctor_user_id=%s AND hospital_user_id=%s AND starts_at BETWEEN %s AND %s", [doctor_id, hospital_id, day_start, day_end]) or {'c':0}
        if max_per_day and int(day_count['c']) >= max_per_day:
            return JsonResponse({'error':'capacity_full'}, status=400)
        # compute serial and approx time
        serial = int(day_count['c']) + 1
        approx_time = None
        try:
            # derive duration from provided ends_at/starts_at; fallback 15 min
            import datetime as _dt
            st = _dt.datetime.fromisoformat(starts_at.replace('Z','+00:00'))
            en = _dt.datetime.fromisoformat(ends_at.replace('Z','+00:00'))
            dur = en - st
            mins = max(1, int(dur.total_seconds() // 60))
            # compute approx start as first slot of the day + (serial-1)*mins if within schedule
            if schedules:
                date_part = st.date()
                first_start = str(schedules[0]['start_time'])
                h, m, *rest = first_start.split(':')
                base = _dt.datetime.combine(date_part, _dt.time(int(h), int(m)))
                approx_dt = base + _dt.timedelta(minutes=(serial-1)*mins)
            else:
                approx_dt = st
            approx_time = approx_dt.strftime('%H:%M')
        except Exception:
            pass
        # Do NOT reject overlaps: we prioritize earlier serials and provide approx_time for later bookings
        appt_id = execute("INSERT INTO appointments(patient_user_id,doctor_user_id,hospital_user_id,starts_at,ends_at,status,serial,approx_time) VALUES(%s,%s,%s,%s,%s,'booked',%s,%s)", [_user['id'], doctor_id, hospital_id, starts_at, ends_at, serial, approx_time])
    finally:
        if got_lock and 'mysql' in engine:
            try:
                query("SELECT RELEASE_LOCK(%s) AS released", [lock_key])
            except Exception:
                pass
    # notify doctor (best-effort) with rich payload for better UX
    try:
        # Resolve hospital display name (prefers hospitals.name, falls back to user full_name)
        hosp = None
        try:
            hosp = query(
                """
                SELECT COALESCE(h.name, u.full_name) AS hospital_name
                FROM users u
                LEFT JOIN hospitals h ON h.user_id=u.id
                WHERE u.id=%s
                """,
                [hospital_id]
            ) or {}
        except Exception:
            hosp = {}
        payload = {
            'appointment_id': appt_id,
            'patient_id': _user.get('id'),
            'patient_name': _user.get('full_name'),
            'hospital_user_id': hospital_id,
            'hospital_name': hosp.get('hospital_name'),
            'starts_at': starts_at,
            'ends_at': ends_at,
            'serial': serial,
            'approx_time': approx_time,
        }
        _notify(doctor_id, 'appointment_booked', payload)
    except Exception:
        pass
    return JsonResponse({'id': appt_id, 'serial': serial, 'approx_time': approx_time})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_my_appointments(request: HttpRequest, _user=None):
    """List appointments for current patient."""
    # Enrich with doctor + hospital display fields for better UX (names, links)
    sql_enriched = (
        """
        SELECT
            a.*,
            du.full_name AS doctor_name,
            du.avatar_url AS doctor_avatar_url,
            COALESCE(doc.id, NULL) AS doctor_id,
            h.id AS hospital_id,
            COALESCE(h.name, hu.full_name) AS hospital_name
        FROM appointments a
        JOIN users du ON du.id = a.doctor_user_id
        LEFT JOIN doctors doc ON doc.user_id = a.doctor_user_id
        LEFT JOIN hospitals h ON h.user_id = a.hospital_user_id
        LEFT JOIN users hu ON hu.id = a.hospital_user_id
        WHERE a.patient_user_id=%s AND COALESCE(a.hidden_by_patient, 0) = 0
        ORDER BY a.starts_at DESC
        """
    )
    rows = query(sql_enriched, [_user['id']], many=True) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_doctor_appointments(request: HttpRequest, _user=None):
    """Doctor: list own appointments (user must be in hospital_doctors somewhere)."""
    # Quick membership detection; also allow access if there are any appointments for this user as doctor
    mem = query("SELECT 1 FROM hospital_doctors WHERE doctor_user_id=%s LIMIT 1", [_user['id']])
    if not mem:
        has_any = query("SELECT 1 FROM appointments WHERE doctor_user_id=%s LIMIT 1", [_user['id']])
        if not has_any:
            return JsonResponse({'error':'not_doctor'}, status=403)
    # Auto-complete: mark any prior-day booked appointments as done, and for today
    # mark booked ones as done after the doctor's last scheduled end time per hospital.
    try:
        import datetime as _dt
        now = _dt.datetime.utcnow()
        # Past days -> done
        try:
            # MySQL path
            execute("UPDATE appointments SET status='done' WHERE doctor_user_id=%s AND status='booked' AND DATE(starts_at) < CURDATE()", [_user['id']])
        except Exception:
            # SQLite path
            try:
                execute("UPDATE appointments SET status='done' WHERE doctor_user_id=? AND status='booked' AND date(starts_at) < date('now')", [_user['id']])
            except Exception:
                pass
        # Today after schedule end per hospital
        # Determine weekday (our schedules use 0=Sunday..6=Saturday)
        wk = (now.weekday() + 1) % 7  # Python: Mon=0..Sun=6 --> 0=Sun
        try:
            hospitals_today = query(
                "SELECT DISTINCT hospital_user_id FROM doctor_schedules WHERE doctor_user_id=%s AND weekday=%s",
                [_user['id'], wk], many=True
            ) or []
        except Exception:
            hospitals_today = []
        for r in hospitals_today:
            hid = r.get('hospital_user_id') if isinstance(r, dict) else None
            if not hid:
                continue
            # Fetch last end_time for this weekday/hospital
            last_end = None
            try:
                le = query(
                    "SELECT MAX(end_time) AS last_end FROM doctor_schedules WHERE doctor_user_id=%s AND hospital_user_id=%s AND weekday=%s",
                    [_user['id'], hid, wk]
                ) or {}
                last_end = le.get('last_end')
            except Exception:
                last_end = None
            if not last_end:
                continue
            # Compare current time-of-day with last_end; do DB-side comparison to avoid TZ pitfalls
            updated = False
            try:
                execute(
                    "UPDATE appointments SET status='done' WHERE doctor_user_id=%s AND hospital_user_id=%s AND status='booked' AND DATE(starts_at)=CURDATE() AND TIME(NOW()) > %s",
                    [_user['id'], hid, str(last_end)[:8]]
                )
                updated = True
            except Exception:
                try:
                    execute(
                        "UPDATE appointments SET status='done' WHERE doctor_user_id=? AND hospital_user_id=? AND status='booked' AND date(starts_at)=date('now') AND time('now') > time(?)",
                        [_user['id'], hid, str(last_end)[:8]]
                    )
                    updated = True
                except Exception:
                    pass
    except Exception:
        # Non-fatal; continue to list
        pass
    # Include patient + hospital display fields; keep raw ids for logic
    rows = query(
        """
        SELECT
            a.*,
            pu.full_name AS patient_name,
            pu.avatar_url AS patient_avatar_url,
            h.id AS hospital_id,
            COALESCE(h.name, hu.full_name) AS hospital_name
        FROM appointments a
        JOIN users pu ON pu.id = a.patient_user_id
        LEFT JOIN hospitals h ON h.user_id = a.hospital_user_id
        LEFT JOIN users hu ON hu.id = a.hospital_user_id
        WHERE a.doctor_user_id=%s
        ORDER BY a.starts_at DESC
        """,
        [_user['id']], many=True
    ) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def confirm_appointment(request: HttpRequest, appointment_id: int, _user=None):
    """Doctor confirms/completes an appointment. Transition: booked -> done.

    Rules:
      - Only the doctor who owns the appointment may confirm it.
      - Only allowed when status is 'booked'.
    """
    ap = query("SELECT * FROM appointments WHERE id=%s", [appointment_id])
    if not ap:
        return JsonResponse({'error': 'not_found'}, status=404)
    if int(ap.get('doctor_user_id')) != int(_user['id']):
        return JsonResponse({'error': 'forbidden'}, status=403)
    if ap.get('status') != 'booked':
        return JsonResponse({'error': 'invalid_status'}, status=400)
    execute("UPDATE appointments SET status='done' WHERE id=%s AND doctor_user_id=%s AND status='booked'", [appointment_id, _user['id']])
    try:
        _notify(int(ap['patient_user_id']), 'appointment_completed', {'appointment_id': appointment_id})
    except Exception:
        pass
    return JsonResponse({'ok': True, 'status': 'done'})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def hide_appointment(request: HttpRequest, appointment_id: int, _user=None):
    """Patient hides an appointment from their view (soft delete).

    Rules:
      - Only the patient who owns the appointment may hide it.
      - No status restriction; typically used for past or cancelled.
      - Adds a boolean column if missing (hidden_by_patient).
    """
    ap = query("SELECT * FROM appointments WHERE id=%s", [appointment_id])
    if not ap:
        return JsonResponse({'error': 'not_found'}, status=404)
    if int(ap.get('patient_user_id')) != int(_user['id']):
        return JsonResponse({'error': 'forbidden'}, status=403)
    execute("UPDATE appointments SET hidden_by_patient=1 WHERE id=%s AND patient_user_id=%s", [appointment_id, _user['id']])
    return JsonResponse({'ok': True})

# -------------------------------------------------------------------------------

@api_view(require_auth=True, methods=['POST'], csrf=False)
def request_cancel_appointment(request: HttpRequest, appointment_id: int, _user=None):
    """Patient requests to cancel an appointment at least 2 hours prior to start.

    Rules:
      - Only the patient who owns the appointment may request cancel.
      - Must be currently 'booked'.
      - Must be at least 2 hours before starts_at.
      - Transition: booked -> cancel_requested.
      - Notify doctor.
    """
    ap = query("SELECT * FROM appointments WHERE id=%s", [appointment_id])
    if not ap:
        return JsonResponse({'error': 'not_found'}, status=404)
    if int(ap.get('patient_user_id')) != int(_user['id']):
        return JsonResponse({'error': 'forbidden'}, status=403)
    if ap.get('status') != 'booked':
        return JsonResponse({'error': 'invalid_status'}, status=400)
    import datetime as _dt
    try:
        now = _dt.datetime.utcnow()
        st = _dt.datetime.fromisoformat(str(ap.get('starts_at')).replace('Z','+00:00'))
        delta = st - now
        if delta.total_seconds() < 2*3600:
            return JsonResponse({'error': 'too_late_to_cancel'}, status=400)
    except Exception:
        # If parsing fails, be conservative
        return JsonResponse({'error': 'invalid_time'}, status=400)
    execute("UPDATE appointments SET status='cancel_requested' WHERE id=%s AND patient_user_id=%s AND status='booked'", [appointment_id, _user['id']])
    try:
        # Include context so doctor sees full details in notification
        hosp = None
        try:
            hosp = query(
                """
                SELECT COALESCE(h.name, u.full_name) AS hospital_name
                FROM users u
                LEFT JOIN hospitals h ON h.user_id=u.id
                WHERE u.id=%s
                """,
                [ap['hospital_user_id']]
            ) or {}
        except Exception:
            hosp = {}
        payload = {
            'appointment_id': appointment_id,
            'by_patient_id': _user['id'],
            'patient_name': _user.get('full_name'),
            'hospital_user_id': ap.get('hospital_user_id'),
            'hospital_name': hosp.get('hospital_name'),
            'starts_at': str(ap.get('starts_at')),
            'ends_at': str(ap.get('ends_at')),
            'serial': ap.get('serial'),
            'approx_time': ap.get('approx_time'),
        }
        _notify(int(ap['doctor_user_id']), 'appointment_cancel_requested', payload)
    except Exception:
        pass
    return JsonResponse({'ok': True, 'status': 'cancel_requested'})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def approve_cancel_appointment(request: HttpRequest, appointment_id: int, _user=None):
    """Doctor approves a pending cancel request. Transition: cancel_requested -> cancelled."""
    ap = query("SELECT * FROM appointments WHERE id=%s", [appointment_id])
    if not ap:
        return JsonResponse({'error': 'not_found'}, status=404)
    if int(ap.get('doctor_user_id')) != int(_user['id']):
        return JsonResponse({'error': 'forbidden'}, status=403)
    if ap.get('status') != 'cancel_requested':
        return JsonResponse({'error': 'invalid_status'}, status=400)
    execute("UPDATE appointments SET status='cancelled' WHERE id=%s AND doctor_user_id=%s AND status='cancel_requested'", [appointment_id, _user['id']])
    try:
        _notify(int(ap['patient_user_id']), 'appointment_cancel_approved', {'appointment_id': appointment_id})
    except Exception:
        pass
    return JsonResponse({'ok': True, 'status': 'cancelled'})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def decline_cancel_appointment(request: HttpRequest, appointment_id: int, _user=None):
    """Doctor declines a pending cancel request. Transition: cancel_requested -> booked."""
    ap = query("SELECT * FROM appointments WHERE id=%s", [appointment_id])
    if not ap:
        return JsonResponse({'error': 'not_found'}, status=404)
    if int(ap.get('doctor_user_id')) != int(_user['id']):
        return JsonResponse({'error': 'forbidden'}, status=403)
    if ap.get('status') != 'cancel_requested':
        return JsonResponse({'error': 'invalid_status'}, status=400)
    execute("UPDATE appointments SET status='booked' WHERE id=%s AND doctor_user_id=%s AND status='cancel_requested'", [appointment_id, _user['id']])
    try:
        _notify(int(ap['patient_user_id']), 'appointment_cancel_declined', {'appointment_id': appointment_id})
    except Exception:
        pass
    return JsonResponse({'ok': True, 'status': 'booked'})

# ============================= PHASE 2: BLOOD REQUESTS ==========================

def _is_hospital(user):
    return user and user.get('role') == 'hospital'

def _is_social_or_bank(user):
    return user and user.get('role') in ('social_org','blood_bank')

def _require_blood_bank(user):
    return user and user.get('role') == 'blood_bank'

@api_view(require_auth=True, methods=['POST'], csrf=False)
def create_blood_request(request: HttpRequest, _user=None):
    """Hospital: create a blood request.
    Body: { blood_type, quantity_units?, needed_by?, notes? }
    """
    if not _is_hospital(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    bt = (data.get('blood_type') or '').upper().strip()
    qty = int(data.get('quantity_units') or 1)
    needed_by = data.get('needed_by')
    notes = data.get('notes')
    if bt not in ('A+','A-','B+','B-','O+','O-','AB+','AB-'):
        return JsonResponse({'error':'invalid_blood_type'}, status=400)
    rid = execute("INSERT INTO blood_requests(hospital_user_id,blood_type,quantity_units,needed_by,notes) VALUES(%s,%s,%s,%s,%s)", [_user['id'], bt, qty, needed_by, notes])
    return JsonResponse({'id': rid})

@api_view(methods=['GET'], csrf=False)
def list_blood_requests(request: HttpRequest, _user=None):
    """List blood requests with optional filters: blood_type, status, hospital_id."""
    bt = request.GET.get('blood_type')
    status_f = request.GET.get('status')
    hosp = request.GET.get('hospital_id')
    where = []
    params = []
    if bt:
        where.append('blood_type=%s'); params.append(bt.upper())
    if status_f:
        where.append('status=%s'); params.append(status_f)
    if hosp:
        where.append('hospital_user_id=%s'); params.append(hosp)
    sql = 'SELECT * FROM blood_requests'
    if where:
        sql += ' WHERE ' + ' AND '.join(where)
    sql += ' ORDER BY created_at DESC LIMIT 200'
    rows = query(sql, params, many=True) or []
    return JsonResponse({'results': rows})

@api_view(methods=['GET'], csrf=False)
def get_blood_request(request: HttpRequest, request_id: int, _user=None):
    row = query("SELECT * FROM blood_requests WHERE id=%s", [request_id])
    if not row:
        return JsonResponse({'error':'not_found'}, status=404)
    return JsonResponse(row)

@api_view(require_auth=True, methods=['PUT'], csrf=False)
def update_blood_request(request: HttpRequest, request_id: int, _user=None):
    """Hospital owner can update open request fields."""
    br = query("SELECT * FROM blood_requests WHERE id=%s", [request_id])
    if not br:
        return JsonResponse({'error':'not_found'}, status=404)
    if br['hospital_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    notes = data.get('notes', br.get('notes'))
    qty = int(data.get('quantity_units') or br.get('quantity_units'))
    needed_by = data.get('needed_by', br.get('needed_by'))
    status_val = data.get('status', br.get('status'))
    execute("UPDATE blood_requests SET notes=%s, quantity_units=%s, needed_by=%s, status=%s WHERE id=%s", [notes, qty, needed_by, status_val, request_id])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def change_blood_request_status(request: HttpRequest, request_id: int, _user=None):
    """Hospital sets status: fulfilled|cancelled|open."""
    br = query("SELECT * FROM blood_requests WHERE id=%s", [request_id])
    if not br:
        return JsonResponse({'error':'not_found'}, status=404)
    if br['hospital_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    status_val = data.get('status')
    if status_val not in ('open','fulfilled','cancelled'):
        return JsonResponse({'error':'invalid_status'}, status=400)
    execute("UPDATE blood_requests SET status=%s WHERE id=%s", [status_val, request_id])
    return JsonResponse({'ok': True})

# ============================= BLOOD BANK ORG MGMT ============================

def _ensure_blood_bank_tables():
    # No-op: schema is managed by final_normalized_schema.sql
    return None

@api_view(require_auth=True, methods=['GET'], csrf=False)
def blood_bank_donors_list(request: HttpRequest, _user=None):
    if not _require_blood_bank(_user) and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_blood_bank_tables()
    rows = query(
        """
        SELECT d.id, d.user_id, d.blood_type, d.notes,
               u.full_name AS user_full_name, u.email AS user_email
        FROM blood_bank_donors d
        JOIN users u ON u.id = d.user_id
        WHERE d.bank_user_id=%s
        ORDER BY u.full_name, u.email
        """,
        [_user['id']], many=True
    ) or []
    return JsonResponse({'results': rows})

@api_view(methods=['GET'], csrf=False)
def blood_bank_donors_of(request: HttpRequest, bank_user_id: int, _user=None):
    """Public: list donors linked to a bank (safe fields only)."""
    _ensure_blood_bank_tables()
    rows = query(
        """
        SELECT d.id, d.user_id, d.blood_type,
               u.full_name AS user_full_name, u.avatar_url AS user_avatar_url
        FROM blood_bank_donors d
        JOIN users u ON u.id = d.user_id
        WHERE d.bank_user_id=%s
        ORDER BY u.full_name, u.id
        """,
        [bank_user_id], many=True
    ) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def blood_bank_donors_add(request: HttpRequest, _user=None):
    if not _require_blood_bank(_user) and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_blood_bank_tables()
    data = json.loads(request.body or '{}')
    user_id = int(data.get('user_id') or 0)
    bt = (data.get('blood_type') or '').upper().strip()
    notes = data.get('notes')
    if bt not in ('A+','A-','B+','B-','O+','O-','AB+','AB-'):
        return JsonResponse({'error':'invalid_blood_type'}, status=400)
    # Ensure target user exists
    u = query("SELECT id FROM users WHERE id=%s", [user_id])
    if not u:
        return JsonResponse({'error':'user_not_found'}, status=404)
    try:
        did = execute("INSERT INTO blood_bank_donors(bank_user_id,user_id,blood_type,notes) VALUES(%s,%s,%s,%s)", [_user['id'], user_id, bt, notes])
        return JsonResponse({'id': did})
    except Exception as e:
        # handle duplicates gracefully
        existing = query("SELECT id FROM blood_bank_donors WHERE bank_user_id=%s AND user_id=%s", [_user['id'], user_id])
        if existing:
            return JsonResponse({'id': existing['id'], 'ok': True, 'detail':'already_added'})
        return JsonResponse({'error':'db_error', 'detail': str(e)}, status=500)

@api_view(require_auth=True, methods=['POST'], csrf=False)
def blood_bank_donors_update(request: HttpRequest, donor_id: int, _user=None):
    if not _require_blood_bank(_user) and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_blood_bank_tables()
    row = query("SELECT * FROM blood_bank_donors WHERE id=%s", [donor_id])
    if not row or (not _require_admin(_user) and row['bank_user_id'] != _user['id']):
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    fields = {}
    if 'blood_type' in data:
        bt = (data.get('blood_type') or '').upper().strip()
        if bt not in ('A+','A-','B+','B-','O+','O-','AB+','AB-'):
            return JsonResponse({'error':'invalid_blood_type'}, status=400)
        fields['blood_type'] = bt
    if 'notes' in data:
        fields['notes'] = data.get('notes')
    if not fields:
        return JsonResponse({'ok': True})
    sets = ",".join([f"{k}=%s" for k in fields.keys()])
    params = list(fields.values()) + [donor_id]
    execute(f"UPDATE blood_bank_donors SET {sets} WHERE id=%s", params)
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def blood_bank_donors_remove(request: HttpRequest, donor_id: int, _user=None):
    if not _require_blood_bank(_user) and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_blood_bank_tables()
    row = query("SELECT * FROM blood_bank_donors WHERE id=%s", [donor_id])
    if not row or (not _require_admin(_user) and row['bank_user_id'] != _user['id']):
        return JsonResponse({'error':'not_found'}, status=404)
    execute("DELETE FROM blood_bank_donors WHERE id=%s", [donor_id])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def blood_bank_staff_list(request: HttpRequest, _user=None):
    if not _require_blood_bank(_user) and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_blood_bank_tables()
    rows = query("SELECT * FROM blood_bank_staff WHERE bank_user_id=%s ORDER BY name", [_user['id']], many=True) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def blood_bank_staff_add(request: HttpRequest, _user=None):
    if not _require_blood_bank(_user) and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_blood_bank_tables()
    data = json.loads(request.body or '{}')
    name = (data.get('name') or '').strip()
    role = (data.get('role') or '').strip() or None
    phone = (data.get('phone') or '').strip() or None
    email = (data.get('email') or '').strip() or None
    if not name:
        return JsonResponse({'error':'name_required'}, status=400)
    sid = execute("INSERT INTO blood_bank_staff(bank_user_id,name,role,phone,email) VALUES(%s,%s,%s,%s,%s)", [_user['id'], name, role, phone, email])
    return JsonResponse({'id': sid})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def blood_bank_staff_update(request: HttpRequest, staff_id: int, _user=None):
    if not _require_blood_bank(_user) and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_blood_bank_tables()
    row = query("SELECT * FROM blood_bank_staff WHERE id=%s", [staff_id])
    if not row or (not _require_admin(_user) and row['bank_user_id'] != _user['id']):
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    fields = {}
    for k in ('name','role','phone','email','status'):
        if k in data:
            fields[k] = data[k]
    if not fields:
        return JsonResponse({'ok': True})
    sets = ",".join([f"{k}=%s" for k in fields.keys()])
    params = list(fields.values()) + [staff_id]
    execute(f"UPDATE blood_bank_staff SET {sets} WHERE id=%s", params)
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def blood_bank_staff_remove(request: HttpRequest, staff_id: int, _user=None):
    if not _require_blood_bank(_user) and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_blood_bank_tables()
    row = query("SELECT * FROM blood_bank_staff WHERE id=%s", [staff_id])
    if not row or (not _require_admin(_user) and row['bank_user_id'] != _user['id']):
        return JsonResponse({'error':'not_found'}, status=404)
    execute("DELETE FROM blood_bank_staff WHERE id=%s", [staff_id])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def blood_inventory_list(request: HttpRequest, _user=None):
    if not _require_blood_bank(_user) and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_blood_bank_tables()
    rows = query("SELECT * FROM blood_inventory WHERE bank_user_id=%s ORDER BY blood_type", [_user['id']], many=True) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def blood_inventory_set(request: HttpRequest, _user=None):
    if not _require_blood_bank(_user) and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_blood_bank_tables()
    data = json.loads(request.body or '{}')
    bt = (data.get('blood_type') or '').upper().strip()
    qty = int(data.get('quantity_units') or 0)
    if bt not in ('A+','A-','B+','B-','O+','O-','AB+','AB-'):
        return JsonResponse({'error':'invalid_blood_type'}, status=400)
    # upsert by (bank_user_id, blood_type)
    try:
        existing = query("SELECT id FROM blood_inventory WHERE bank_user_id=%s AND blood_type=%s", [_user['id'], bt])
        if existing:
            execute("UPDATE blood_inventory SET quantity_units=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s", [qty, existing['id']])
            return JsonResponse({'id': existing['id'], 'ok': True})
        else:
            iid = execute("INSERT INTO blood_inventory(bank_user_id,blood_type,quantity_units) VALUES(%s,%s,%s)", [_user['id'], bt, qty])
            return JsonResponse({'id': iid})
    except Exception as e:
        return JsonResponse({'error':'db_error', 'detail': str(e)}, status=500)

@api_view(require_auth=True, methods=['POST'], csrf=False)
def blood_inventory_issue(request: HttpRequest, _user=None):
    """Manually issue units from bank inventory.

    Body: { blood_type, quantity_units, purpose?, issued_to_name?, issued_to_contact? }
    Effects: decrements inventory immediately; records issuance row.
    """
    if not _require_blood_bank(_user) and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_blood_bank_tables()
    data = json.loads(request.body or '{}')
    bt = (data.get('blood_type') or '').upper().strip()
    try:
        qty = int(data.get('quantity_units') or 0)
    except Exception:
        return JsonResponse({'error':'invalid_quantity'}, status=400)
    if bt not in VALID_BLOOD_TYPES:
        return JsonResponse({'error':'invalid_blood_type'}, status=400)
    if qty < 1:
        return JsonResponse({'error':'invalid_quantity'}, status=400)
    # Check inventory
    inv = query("SELECT id, quantity_units FROM blood_inventory WHERE bank_user_id=%s AND blood_type=%s", [_user['id'], bt])
    if not inv or int(inv['quantity_units']) < qty:
        return JsonResponse({'error':'insufficient_inventory'}, status=400)
    # Decrement
    new_qty = int(inv['quantity_units']) - qty
    execute("UPDATE blood_inventory SET quantity_units=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s", [new_qty, inv['id']])
    # Insert issuance record
    purpose = data.get('purpose')
    issued_to_name = _limit_str(data.get('issued_to_name') or None, 255)
    issued_to_contact = _limit_str(data.get('issued_to_contact') or None, 255)
    iid = execute(
        "INSERT INTO blood_inventory_issuances(bank_user_id,blood_type,quantity_units,purpose,issued_to_name,issued_to_contact) VALUES(%s,%s,%s,%s,%s,%s)",
        [_user['id'], bt, qty, purpose, issued_to_name, issued_to_contact]
    )
    return JsonResponse({'id': iid})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def blood_inventory_issuances_list(request: HttpRequest, _user=None):
    if not _require_blood_bank(_user) and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_blood_bank_tables()
    rows = query(
        "SELECT * FROM blood_inventory_issuances WHERE bank_user_id=%s ORDER BY created_at DESC",
        [_user['id']], many=True
    ) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def blood_inventory_issuance_update(request: HttpRequest, issuance_id: int, _user=None):
    if not _require_blood_bank(_user) and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_blood_bank_tables()
    row = query("SELECT * FROM blood_inventory_issuances WHERE id=%s", [issuance_id])
    if not row or (not _require_admin(_user) and row['bank_user_id'] != _user['id']):
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    # Allow editing purpose and issued_to*; allow status revert which restores inventory
    fields = {}
    for k in ('purpose','issued_to_name','issued_to_contact'):
        if k in data:
            fields[k] = data.get(k)
    if 'status' in data and data.get('status') in ('issued','reverted'):
        new_status = data.get('status')
        if row['status'] != new_status:
            # If reverting, add units back
            if new_status == 'reverted':
                inv = query("SELECT id,quantity_units FROM blood_inventory WHERE bank_user_id=%s AND blood_type=%s", [row['bank_user_id'], row['blood_type']])
                if inv:
                    execute("UPDATE blood_inventory SET quantity_units=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s", [int(inv['quantity_units']) + int(row['quantity_units']), inv['id']])
                else:
                    execute("INSERT INTO blood_inventory(bank_user_id,blood_type,quantity_units) VALUES(%s,%s,%s)", [row['bank_user_id'], row['blood_type'], int(row['quantity_units'])])
            fields['status'] = new_status
    if not fields:
        return JsonResponse({'ok': True})
    sets = ",".join([f"{k}=%s" for k in fields.keys()])
    params = list(fields.values()) + [issuance_id]
    execute(f"UPDATE blood_inventory_issuances SET {sets} WHERE id=%s", params)
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def blood_inventory_issuance_delete(request: HttpRequest, issuance_id: int, _user=None):
    if not _require_blood_bank(_user) and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_blood_bank_tables()
    row = query("SELECT * FROM blood_inventory_issuances WHERE id=%s", [issuance_id])
    if not row or (not _require_admin(_user) and row['bank_user_id'] != _user['id']):
        return JsonResponse({'error':'not_found'}, status=404)
    # If deleting an issued (not reverted) record, restore inventory to avoid loss
    if row['status'] == 'issued':
        inv = query("SELECT id,quantity_units FROM blood_inventory WHERE bank_user_id=%s AND blood_type=%s", [row['bank_user_id'], row['blood_type']])
        if inv:
            execute("UPDATE blood_inventory SET quantity_units=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s", [int(inv['quantity_units']) + int(row['quantity_units']), inv['id']])
        else:
            execute("INSERT INTO blood_inventory(bank_user_id,blood_type,quantity_units) VALUES(%s,%s,%s)", [row['bank_user_id'], row['blood_type'], int(row['quantity_units'])])
    execute("DELETE FROM blood_inventory_issuances WHERE id=%s", [issuance_id])
    return JsonResponse({'ok': True})

# ======================= BANK INVENTORY REQUEST FLOW =========================

@api_view(require_auth=True, methods=['POST'], csrf=False)
def create_inventory_request(request: HttpRequest, _user=None):
    """User requests blood units from a bank's inventory.

    Body: { bank_user_id, blood_type, quantity_units, target_datetime, location_text, crisis_id? }
    """
    _ensure_blood_bank_tables()
    data = json.loads(request.body or '{}')
    try:
        bank_user_id = int(data.get('bank_user_id'))
        qty = int(data.get('quantity_units'))
    except Exception:
        return JsonResponse({'error':'invalid_input'}, status=400)
    bt = (data.get('blood_type') or '').upper().strip()
    when = data.get('target_datetime')
    loc = _limit_str(data.get('location_text') or None, 255)
    crisis_id = None
    try:
        crisis_id = int(data.get('crisis_id')) if data.get('crisis_id') is not None else None
    except Exception:
        crisis_id = None
    if bt not in VALID_BLOOD_TYPES:
        return JsonResponse({'error':'invalid_blood_type'}, status=400)
    if qty < 1:
        return JsonResponse({'error':'invalid_quantity'}, status=400)
    # Default target time to now if omitted to satisfy NOT NULL constraint
    if not when:
        import datetime as _dt
        when = _dt.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    rid = execute(
        "INSERT INTO blood_inventory_requests(requester_user_id,bank_user_id,blood_type,quantity_units,target_datetime,location_text,crisis_id) VALUES(%s,%s,%s,%s,%s,%s,%s)",
        [_user['id'], bank_user_id, bt, qty, when, loc, crisis_id]
    )
    try:
        _notify(bank_user_id, 'inventory_request_created', {'request_id': rid, 'blood_type': bt, 'quantity_units': qty})
    except Exception:
        pass
    return JsonResponse({'id': rid})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_inventory_requests(request: HttpRequest, _user=None):
    """List inventory requests. Filters: bank_user_id, requester_user_id, crisis_id (one required unless admin with all=1)."""
    _ensure_blood_bank_tables()
    bank_id = request.GET.get('bank_user_id')
    req_id = request.GET.get('requester_user_id')
    crisis_id = request.GET.get('crisis_id')
    show_all = request.GET.get('all') in ('1','true','yes')
    where=[]; params=[]
    if bank_id:
        where.append('rir.bank_user_id=%s'); params.append(bank_id)
    if req_id:
        where.append('rir.requester_user_id=%s'); params.append(req_id)
    if crisis_id:
        where.append('rir.crisis_id=%s'); params.append(crisis_id)
    # Admins may request all without filters
    if not where and not (show_all and _require_admin(_user)):
        return JsonResponse({'error':'missing_filter'}, status=400)
    rows = query(
        f"""
        SELECT rir.*, u.full_name AS requester_name
        FROM blood_inventory_requests rir
        JOIN users u ON u.id = rir.requester_user_id
        {'WHERE ' + ' AND '.join(where) if where else ''}
        ORDER BY rir.created_at DESC
        """,
        params, many=True
    ) or []
    return JsonResponse({'results': rows})

def _hours_until(dt_str: str) -> float:
    """Return hours until target datetime.
    - If `dt_str` includes timezone info, compare using that timezone.
    - If `dt_str` is naive (no tz), treat it as local server time and compare with datetime.now().
    This avoids mixing a naive local time with UTC and incorrectly returning negative/too-small values.
    """
    try:
        from datetime import datetime, timezone
        if not dt_str:
            return 0.0
        s = str(dt_str).strip()
        # Normalize 'Z' to '+00:00' for fromisoformat compatibility
        if s.endswith('Z'):
            s = s[:-1] + '+00:00'
        # Replace space ' ' with 'T' is optional; fromisoformat supports both
        # Attempt ISO parse (supports 'YYYY-MM-DD HH:MM:SS[.fff][+/-HH:MM]')
        target = datetime.fromisoformat(s.replace('T', ' '))
        if target.tzinfo is not None:
            now = datetime.now(target.tzinfo)
        else:
            # Naive time: assume server local clock
            now = datetime.now()
        delta = (target - now).total_seconds() / 3600.0
        return delta
    except Exception:
        return 0.0

@api_view(require_auth=True, methods=['POST'], csrf=False)
def update_inventory_request_status(request: HttpRequest, request_id: int, _user=None):
    _ensure_blood_bank_tables()
    row = query("SELECT * FROM blood_inventory_requests WHERE id=%s", [request_id])
    if not row:
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    new_status = data.get('status')
    if new_status not in ('accepted','rejected','cancelled','completed'):
        return JsonResponse({'error':'invalid_status'}, status=400)
    # Permissions and rules
    is_bank = _user['id'] == row['bank_user_id'] or _require_admin(_user)
    is_requester = _user['id'] == row['requester_user_id']
    if new_status in ('accepted','rejected','completed') and not is_bank:
        return JsonResponse({'error':'forbidden'}, status=403)
    if new_status == 'cancelled' and not (is_bank or is_requester):
        return JsonResponse({'error':'forbidden'}, status=403)
    # Cancel rule: up to 2 hours prior
    if new_status == 'cancelled':
        if _hours_until(row['target_datetime']) < 2.0:
            return JsonResponse({'error':'too_late_to_cancel'}, status=400)
        execute("UPDATE blood_inventory_requests SET status='cancelled' WHERE id=%s", [request_id])
        try:
            other = row['bank_user_id'] if is_requester else row['requester_user_id']
            _notify(other, 'inventory_request_cancelled', {'request_id': request_id})
        except Exception:
            pass
        return JsonResponse({'ok': True})
    if row['status'] in ('rejected','cancelled','completed'):
        return JsonResponse({'error':'immutable'}, status=400)
    if new_status == 'accepted':
        inv = query("SELECT quantity_units FROM blood_inventory WHERE bank_user_id=%s AND blood_type=%s", [row['bank_user_id'], row['blood_type']])
        if not inv or int(inv['quantity_units']) < int(row['quantity_units']):
            execute("UPDATE blood_inventory_requests SET status='rejected', reject_reason='insufficient_inventory' WHERE id=%s", [request_id])
            try: _notify(row['requester_user_id'], 'inventory_request_rejected', {'request_id': request_id, 'reason':'insufficient_inventory'})
            except Exception: pass
            return JsonResponse({'error':'insufficient_inventory', 'auto':'rejected'}, status=400)
        execute("UPDATE blood_inventory_requests SET status='accepted' WHERE id=%s", [request_id])
        try: _notify(row['requester_user_id'], 'inventory_request_accepted', {'request_id': request_id})
        except Exception: pass
        return JsonResponse({'ok': True})
    if new_status == 'rejected':
        reason = _limit_str(data.get('reason') or None, 255)
        execute("UPDATE blood_inventory_requests SET status='rejected', reject_reason=%s WHERE id=%s", [reason, request_id])
        try: _notify(row['requester_user_id'], 'inventory_request_rejected', {'request_id': request_id, 'reason': reason})
        except Exception: pass
        return JsonResponse({'ok': True})
    if new_status == 'completed':
        # Decrement inventory on completion
        try:
            inv = query("SELECT id,quantity_units FROM blood_inventory WHERE bank_user_id=%s AND blood_type=%s", [row['bank_user_id'], row['blood_type']])
            if inv:
                new_qty = max(0, int(inv['quantity_units']) - int(row['quantity_units']))
                execute("UPDATE blood_inventory SET quantity_units=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s", [new_qty, inv['id']])
        except Exception:
            pass
        execute("UPDATE blood_inventory_requests SET status='completed' WHERE id=%s", [request_id])
        try: _notify(row['requester_user_id'], 'inventory_request_completed', {'request_id': request_id})
        except Exception: pass
        return JsonResponse({'ok': True})

# ======================= DONOR MEETING REQUEST FLOW ==========================

@api_view(require_auth=True, methods=['POST'], csrf=False)
def create_donor_meeting_request(request: HttpRequest, _user=None):
    """User requests donation from a specific donor.

    Body: { donor_user_id, target_datetime, location_text, blood_type?, crisis_id? }
    """
    _ensure_blood_bank_tables()
    data = json.loads(request.body or '{}')
    try:
        donor_user_id = int(data.get('donor_user_id'))
    except Exception:
        return JsonResponse({'error':'invalid_input'}, status=400)
    bt = (data.get('blood_type') or '').upper().strip() if data.get('blood_type') else None
    if bt and bt not in VALID_BLOOD_TYPES:
        return JsonResponse({'error':'invalid_blood_type'}, status=400)
    when = data.get('target_datetime')
    loc = _limit_str(data.get('location_text') or None, 255)
    crisis_id = None
    try:
        crisis_id = int(data.get('crisis_id')) if data.get('crisis_id') is not None else None
    except Exception:
        crisis_id = None
    # Default target time to now if omitted to satisfy NOT NULL constraint
    if not when:
        import datetime as _dt
        when = _dt.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    # Prevent creating requests within donor cooldown window based on last completed donation
    try:
        last = query("SELECT cooldown_days_after_completion, updated_at FROM blood_donor_meeting_requests WHERE donor_user_id=%s AND status='completed' ORDER BY updated_at DESC LIMIT 1", [donor_user_id])
        if last and last.get('cooldown_days_after_completion'):
            from datetime import datetime, timedelta
            cooldown = int(last['cooldown_days_after_completion'] or 0)
            if cooldown > 0:
                # Parse timestamps robustly (handle 'T' and fractional seconds)
                last_done = datetime.fromisoformat(str(last['updated_at']).replace('T',' ').split('.')[0])
                tgt = datetime.fromisoformat(str(when).replace('T',' ').split('.')[0])
                next_ok = last_done + timedelta(days=cooldown)
                if tgt < next_ok:
                    return JsonResponse({'error':'cooldown_active', 'until': next_ok.isoformat(sep=' ', timespec='seconds')}, status=400)
    except Exception:
        # On parse/DB issues, do not block creation; server logs would help diagnose in real env
        pass
    # Also enforce profile-level cooldown_until if present
    try:
        prof = query("SELECT cooldown_until FROM donor_profiles WHERE user_id=%s", [donor_user_id])
        if prof and prof.get('cooldown_until'):
            from datetime import datetime
            cu = datetime.fromisoformat(str(prof['cooldown_until']).replace('T',' ').split('.')[0])
            tgt = datetime.fromisoformat(str(when).replace('T',' ').split('.')[0])
            if tgt < cu:
                return JsonResponse({'error':'cooldown_active', 'until': cu.isoformat(sep=' ', timespec='seconds')}, status=400)
    except Exception:
        pass
    rid = execute(
        "INSERT INTO blood_donor_meeting_requests(requester_user_id,donor_user_id,blood_type,target_datetime,location_text,crisis_id) VALUES(%s,%s,%s,%s,%s,%s)",
        [_user['id'], donor_user_id, bt, when, loc, crisis_id]
    )
    try:
        _notify(donor_user_id, 'donor_meeting_request_created', {'request_id': rid})
    except Exception:
        pass
    return JsonResponse({'id': rid})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_donor_meeting_requests(request: HttpRequest, _user=None):
    """List donor meeting requests. Filters: donor_user_id, requester_user_id, crisis_id (one required unless admin with all=1)."""
    donor_id = request.GET.get('donor_user_id')
    req_id = request.GET.get('requester_user_id')
    crisis_id = request.GET.get('crisis_id')
    show_all = request.GET.get('all') in ('1','true','yes')
    where=[]; params=[]
    if donor_id:
        where.append('r.donor_user_id=%s'); params.append(donor_id)
    if req_id:
        where.append('r.requester_user_id=%s'); params.append(req_id)
    if crisis_id:
        where.append('r.crisis_id=%s'); params.append(crisis_id)
    if not where and not (show_all and _require_admin(_user)):
        return JsonResponse({'error':'missing_filter'}, status=400)
    rows = query(
        f"""
        SELECT r.*, u.full_name AS requester_name
        FROM blood_donor_meeting_requests r
        JOIN users u ON u.id = r.requester_user_id
        {'WHERE ' + ' AND '.join(where) if where else ''}
        ORDER BY r.created_at DESC
        """,
        params, many=True
    ) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def update_donor_meeting_request_status(request: HttpRequest, request_id: int, _user=None):
    row = query("SELECT * FROM blood_donor_meeting_requests WHERE id=%s", [request_id])
    if not row:
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    new_status = data.get('status')
    if new_status not in ('accepted','rejected','cancelled','completed'):
        return JsonResponse({'error':'invalid_status'}, status=400)
    is_donor = _user['id'] == row['donor_user_id'] or _require_admin(_user)
    is_requester = _user['id'] == row['requester_user_id']
    if new_status in ('accepted','rejected','completed') and not is_donor:
        return JsonResponse({'error':'forbidden'}, status=403)
    if new_status == 'cancelled' and not (is_donor or is_requester):
        return JsonResponse({'error':'forbidden'}, status=403)
    if new_status == 'cancelled':
        if _hours_until(row['target_datetime']) < 2.0:
            return JsonResponse({'error':'too_late_to_cancel'}, status=400)
        execute("UPDATE blood_donor_meeting_requests SET status='cancelled' WHERE id=%s", [request_id])
        try:
            other = row['donor_user_id'] if is_requester else row['requester_user_id']
            _notify(other, 'donor_meeting_request_cancelled', {'request_id': request_id})
        except Exception:
            pass
        return JsonResponse({'ok': True})
    if row['status'] in ('rejected','cancelled','completed'):
        return JsonResponse({'error':'immutable'}, status=400)
    if new_status == 'accepted':
        # Enforce cooldown from last completed donation with recorded cooldown_days
        last = query("SELECT cooldown_days_after_completion, updated_at FROM blood_donor_meeting_requests WHERE donor_user_id=%s AND status='completed' ORDER BY updated_at DESC LIMIT 1", [row['donor_user_id']])
        if last and last.get('cooldown_days_after_completion'):
            try:
                from datetime import datetime, timedelta
                cooldown = int(last['cooldown_days_after_completion'])
                next_ok = datetime.fromisoformat(str(last['updated_at']).replace('T',' ').split('.')[0]) + timedelta(days=cooldown)
                tgt = datetime.fromisoformat(str(row['target_datetime']).replace('T',' ').split('.')[0])
                if tgt < next_ok:
                    return JsonResponse({'error':'cooldown_active', 'until': next_ok.isoformat(sep=' ', timespec='seconds')}, status=400)
            except Exception:
                pass
        # Enforce profile-level cooldown_until
        try:
            prof = query("SELECT cooldown_until FROM donor_profiles WHERE user_id=%s", [row['donor_user_id']])
            if prof and prof.get('cooldown_until'):
                from datetime import datetime
                cu = datetime.fromisoformat(str(prof['cooldown_until']).replace('T',' ').split('.')[0])
                tgt = datetime.fromisoformat(str(row['target_datetime']).replace('T',' ').split('.')[0])
                if tgt < cu:
                    return JsonResponse({'error':'cooldown_active', 'until': cu.isoformat(sep=' ', timespec='seconds')}, status=400)
        except Exception:
            pass
        execute("UPDATE blood_donor_meeting_requests SET status='accepted' WHERE id=%s", [request_id])
        try: _notify(row['requester_user_id'], 'donor_meeting_request_accepted', {'request_id': request_id})
        except Exception: pass
        return JsonResponse({'ok': True})
    if new_status == 'rejected':
        execute("UPDATE blood_donor_meeting_requests SET status='rejected' WHERE id=%s", [request_id])
        try: _notify(row['requester_user_id'], 'donor_meeting_request_rejected', {'request_id': request_id})
        except Exception: pass
        return JsonResponse({'ok': True})
    if new_status == 'completed':
        try:
            # Default to 10 days if not provided or invalid; explicit 0 disables cooldown
            cd_raw = data.get('cooldown_days')
            cooldown_days = int(cd_raw) if (cd_raw is not None and str(cd_raw).strip() != '') else 10
        except Exception:
            cooldown_days = 10
        execute("UPDATE blood_donor_meeting_requests SET status='completed', cooldown_days_after_completion=%s WHERE id=%s", [cooldown_days or None, request_id])
        # Update donor_profiles.last_donation_date
        try:
            execute("UPDATE donor_profiles SET last_donation_date=CURDATE() WHERE user_id=%s", [row['donor_user_id']])
        except Exception:
            pass
        try: _notify(row['requester_user_id'], 'donor_meeting_request_completed', {'request_id': request_id})
        except Exception: pass
        return JsonResponse({'ok': True})

# Recruit posts
@api_view(require_auth=True, methods=['POST'], csrf=False)
def create_recruit_post(request: HttpRequest, _user=None):
    if not _is_social_or_bank(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    blood_request_id = data.get('blood_request_id')
    target_bt = data.get('target_blood_type')
    if target_bt:
        target_bt = target_bt.upper()
        if target_bt not in ('A+','A-','B+','B-','O+','O-','AB+','AB-'):
            return JsonResponse({'error':'invalid_blood_type'}, status=400)
    location_text = _limit_str(data.get('location_text',''),255)
    scheduled_at = data.get('scheduled_at')
    notes = data.get('notes')
    # Prefer inserting with an explicit 'active' status; fall back if column not present
    try:
        rid = execute(
            "INSERT INTO blood_donor_recruit_posts(owner_user_id,blood_request_id,target_blood_type,location_text,scheduled_at,notes,status) VALUES(%s,%s,%s,%s,%s,%s,%s)",
            [_user['id'], blood_request_id, target_bt, location_text, scheduled_at, notes, 'active']
        )
    except Exception:
        # For older schemas without a status column
        rid = execute(
            "INSERT INTO blood_donor_recruit_posts(owner_user_id,blood_request_id,target_blood_type,location_text,scheduled_at,notes) VALUES(%s,%s,%s,%s,%s,%s)",
            [_user['id'], blood_request_id, target_bt, location_text, scheduled_at, notes]
        )
    return JsonResponse({'id': rid})

@api_view(methods=['GET'], csrf=False)
def list_recruit_posts(request: HttpRequest, _user=None):
    bt = request.GET.get('blood_type')
    status_f = request.GET.get('status')
    owner = request.GET.get('owner_user_id')
    where=[]; params=[]
    if bt:
        where.append('target_blood_type=%s'); params.append(bt.upper())
    if status_f:
        # Treat NULL status as 'active' for compatibility with older rows
        if status_f == 'active':
            where.append("(status='active' OR status IS NULL)")
        else:
            where.append('status=%s'); params.append(status_f)
    if owner:
        where.append('owner_user_id=%s'); params.append(owner)
    sql='SELECT * FROM blood_donor_recruit_posts'
    if where:
        sql += ' WHERE ' + ' AND '.join(where)
    sql += ' ORDER BY created_at DESC LIMIT 200'
    rows = query(sql, params, many=True) or []
    return JsonResponse({'results': rows})

@api_view(methods=['GET'], csrf=False)
def get_recruit_post(request: HttpRequest, post_id: int, _user=None):
    row = query("SELECT * FROM blood_donor_recruit_posts WHERE id=%s", [post_id])
    if not row:
        return JsonResponse({'error':'not_found'}, status=404)
    return JsonResponse(row)

@api_view(require_auth=True, methods=['PUT'], csrf=False)
def update_recruit_post(request: HttpRequest, post_id: int, _user=None):
    rp = query("SELECT * FROM blood_donor_recruit_posts WHERE id=%s", [post_id])
    if not rp:
        return JsonResponse({'error':'not_found'}, status=404)
    if rp['owner_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    notes = data.get('notes', rp.get('notes'))
    location_text = _limit_str(data.get('location_text', rp.get('location_text') or ''),255)
    scheduled_at = data.get('scheduled_at', rp.get('scheduled_at'))
    status_val = data.get('status', rp.get('status'))
    execute("UPDATE blood_donor_recruit_posts SET notes=%s, location_text=%s, scheduled_at=%s, status=%s WHERE id=%s", [notes, location_text, scheduled_at, status_val, post_id])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def close_recruit_post(request: HttpRequest, post_id: int, _user=None):
    rp = query("SELECT * FROM blood_donor_recruit_posts WHERE id=%s", [post_id])
    if not rp:
        return JsonResponse({'error':'not_found'}, status=404)
    if rp['owner_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    execute("UPDATE blood_donor_recruit_posts SET status='closed' WHERE id=%s", [post_id])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def delete_recruit_post(request: HttpRequest, post_id: int, _user=None):
    """Delete a recruit post (and its applications).

    We use POST to align with other delete-style actions in this API.
    """
    rp = query("SELECT * FROM blood_donor_recruit_posts WHERE id=%s", [post_id])
    if not rp:
        return JsonResponse({'error':'not_found'}, status=404)
    if rp['owner_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    try:
        # Remove applications first (FKs may not be enforced in this schema)
        execute("DELETE FROM blood_donor_applications WHERE recruit_post_id=%s", [post_id])
        execute("DELETE FROM blood_donor_recruit_posts WHERE id=%s", [post_id])
        return JsonResponse({'ok': True})
    except Exception as e:
        return JsonResponse({'error':'db_error', 'detail': str(e)}, status=500)

# Applications
@api_view(require_auth=True, methods=['POST'], csrf=False)
def apply_recruit_post(request: HttpRequest, post_id: int, _user=None):
    rp = query("SELECT * FROM blood_donor_recruit_posts WHERE id=%s", [post_id])
    if not rp:
        return JsonResponse({'error':'not_found'}, status=404)
    # Treat NULL/empty/'open'/'active' (any case) as open
    try:
        raw = rp.get('status', 'active') if isinstance(rp, dict) else 'active'
    except Exception:
        raw = 'active'
    status_norm = (str(raw).lower().strip() if raw is not None else 'active')
    is_open = (status_norm in ('', 'open', 'active'))
    if not is_open:
        return JsonResponse({'error':'closed'}, status=400)
    data = json.loads(request.body or '{}')
    availability_at = data.get('availability_at')
    notes = data.get('notes')
    # Ensure unique application
    existing = query("SELECT id FROM blood_donor_applications WHERE recruit_post_id=%s AND donor_user_id=%s", [post_id, _user['id']])
    if existing:
        return JsonResponse({'error':'already_applied'}, status=400)
    app_id = execute("INSERT INTO blood_donor_applications(recruit_post_id,donor_user_id,availability_at,notes) VALUES(%s,%s,%s,%s)", [post_id, _user['id'], availability_at, notes])
    try:
        _notify(rp['owner_user_id'], 'donor_applied', {'application_id': app_id, 'post_id': post_id})
    except Exception:
        pass
    return JsonResponse({'id': app_id})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_recruit_applications(request: HttpRequest, post_id: int, _user=None):
    rp = query("SELECT * FROM blood_donor_recruit_posts WHERE id=%s", [post_id])
    if not rp:
        return JsonResponse({'error':'not_found'}, status=404)
    if rp['owner_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    # Enrich with applicant user fields and donor profile blood type
    rows = query(
        """
        SELECT a.*, u.full_name AS donor_full_name, u.email AS donor_email, u.avatar_url AS donor_avatar_url,
               dp.blood_type AS donor_blood_type
        FROM blood_donor_applications a
        JOIN users u ON u.id = a.donor_user_id
        LEFT JOIN donor_profiles dp ON dp.user_id = a.donor_user_id
        WHERE a.recruit_post_id=%s
        ORDER BY a.created_at ASC
        """,
        [post_id],
        many=True
    ) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def update_application_status(request: HttpRequest, application_id: int, _user=None):
    app = query("SELECT * FROM blood_donor_applications WHERE id=%s", [application_id])
    if not app:
        return JsonResponse({'error':'not_found'}, status=404)
    rp = query("SELECT * FROM blood_donor_recruit_posts WHERE id=%s", [app['recruit_post_id']])
    if not rp:
        return JsonResponse({'error':'not_found'}, status=404)
    if rp['owner_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    status_val = data.get('status')
    if status_val not in ('pending','accepted','rejected','attended'):
        return JsonResponse({'error':'invalid_status'}, status=400)
    execute("UPDATE blood_donor_applications SET status=%s WHERE id=%s", [status_val, application_id])
    # If accepted, auto-add to bank's donor list
    if status_val == 'accepted':
        try:
            _ensure_blood_bank_tables()
            # Find bank user id (owner of the recruit post)
            bank_user_id = rp['owner_user_id']
            # Derive blood type: prefer donor's donor_profile if exists; else target_blood_type on post; else skip
            donor_prof = query("SELECT blood_type FROM donor_profiles WHERE user_id=%s", [app['donor_user_id']])
            bt = (donor_prof and donor_prof.get('blood_type')) or (rp.get('target_blood_type'))
            if bt and bt in ('A+','A-','B+','B-','O+','O-','AB+','AB-'):
                existing = query("SELECT id FROM blood_bank_donors WHERE bank_user_id=%s AND user_id=%s", [bank_user_id, app['donor_user_id']])
                if not existing:
                    execute("INSERT INTO blood_bank_donors(bank_user_id,user_id,blood_type,notes) VALUES(%s,%s,%s,%s)", [bank_user_id, app['donor_user_id'], bt, 'Recruited via post #' + str(app['recruit_post_id'])])
        except Exception:
            # non-fatal if donor insertion fails
            pass
    try:
        _notify(app['donor_user_id'], 'application_status', {'application_id': application_id, 'status': status_val})
    except Exception:
        pass
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def my_applications(request: HttpRequest, _user=None):
    rows = query("SELECT * FROM blood_donor_applications WHERE donor_user_id=%s ORDER BY created_at DESC", [_user['id']], many=True) or []
    return JsonResponse({'results': rows})

# Simple overview
@api_view(methods=['GET'], csrf=False)
def blood_overview(request: HttpRequest, _user=None):
    counts = query("SELECT blood_type, COUNT(*) AS c FROM blood_requests WHERE status='open' GROUP BY blood_type", [], many=True) or []
    return JsonResponse({'open_by_blood_type': counts})

# ============================= BLOOD DIRECT REQUESTS ==========================

# Status values for direct requests and responses
DIRECT_REQUEST_STATUSES = {'open','accepted','fulfilled','cancelled'}
DIRECT_RESPONSE_STATUSES = {'pending','accepted','declined','cancelled'}

@api_view(require_auth=True, methods=['POST'], csrf=False)
def create_blood_direct_request(request: HttpRequest, _user=None):
    """Create a direct blood donor request.

    Body: { target_blood_type, quantity_units?, notes? }
    Any authenticated user may create (could be a patient or representative). We rely on
    donor_profiles for potential donors to discover/respond.
    Returns: { id }
    """
    data = json.loads(request.body or '{}')
    bt = (data.get('target_blood_type') or '').upper().strip()
    if bt not in VALID_BLOOD_TYPES:
        return JsonResponse({'error':'invalid_blood_type'}, status=400)
    qty = int(data.get('quantity_units') or 1)
    if qty < 1:
        qty = 1
    notes = data.get('notes')
    rid = execute("INSERT INTO blood_direct_requests(requester_user_id,target_blood_type,quantity_units,notes) VALUES(%s,%s,%s,%s)", [_user['id'], bt, qty, notes])
    return JsonResponse({'id': rid})

@api_view(methods=['GET'], csrf=False)
def list_blood_direct_requests(request: HttpRequest, _user=None):
    """List direct blood requests.

    Filters (query params): blood_type, status, requester_user_id.
    Public endpoint (sensitive notes could be filtered later; for MVP we expose notes).
    """
    bt = request.GET.get('blood_type')
    status_f = request.GET.get('status')
    requester = request.GET.get('requester_user_id')
    where=[]; params=[]
    if bt:
        where.append('target_blood_type=%s'); params.append(bt.upper())
    if status_f:
        where.append('status=%s'); params.append(status_f)
    if requester:
        where.append('requester_user_id=%s'); params.append(requester)
    sql = 'SELECT * FROM blood_direct_requests'
    if where:
        sql += ' WHERE ' + ' AND '.join(where)
    sql += ' ORDER BY created_at DESC LIMIT 200'
    rows = query(sql, params, many=True) or []
    return JsonResponse({'results': rows})

@api_view(methods=['GET'], csrf=False)
def get_blood_direct_request(request: HttpRequest, request_id: int, _user=None):
    row = query("SELECT * FROM blood_direct_requests WHERE id=%s", [request_id])
    if not row:
        return JsonResponse({'error':'not_found'}, status=404)
    # Attach responses (public but minimal fields)
    responses = query("SELECT id,donor_user_id,status,message,created_at FROM blood_direct_request_responses WHERE request_id=%s ORDER BY id ASC", [request_id], many=True) or []
    row['responses'] = responses
    return JsonResponse(row)

@api_view(require_auth=True, methods=['POST'], csrf=False)
def respond_blood_direct_request(request: HttpRequest, request_id: int, _user=None):
    """Donor user responds to a direct request.

    Body: { message? }
    Requirements: user must have donor_profile with blood_type matching request.target_blood_type.
    Returns: { id }
    """
    req = query("SELECT * FROM blood_direct_requests WHERE id=%s", [request_id])
    if not req:
        return JsonResponse({'error':'not_found'}, status=404)
    if req['status'] not in ('open',):
        return JsonResponse({'error':'not_open'}, status=400)
    donor_prof = query("SELECT blood_type FROM donor_profiles WHERE user_id=%s", [_user['id']])
    if not donor_prof or donor_prof['blood_type'] != req['target_blood_type']:
        return JsonResponse({'error':'blood_type_mismatch'}, status=400)
    existing = query("SELECT id,status FROM blood_direct_request_responses WHERE request_id=%s AND donor_user_id=%s", [request_id, _user['id']])
    if existing:
        if existing['status'] in ('cancelled','declined'):
            # allow reactivation by setting pending again
            execute("UPDATE blood_direct_request_responses SET status='pending' WHERE id=%s", [existing['id']])
            resp_id = existing['id']
        else:
            return JsonResponse({'error':'already_responded'}, status=400)
    else:
        data = json.loads(request.body or '{}')
        message = _limit_str(data.get('message','') or None, 500) if data.get('message') else None
        resp_id = execute("INSERT INTO blood_direct_request_responses(request_id,donor_user_id,message) VALUES(%s,%s,%s)", [request_id, _user['id'], message])
    # notify requester
    try:
        _notify(req['requester_user_id'], 'blood_direct_response', {'request_id': request_id, 'response_id': resp_id, 'donor_user_id': _user['id']})
    except Exception:
        pass
    return JsonResponse({'id': resp_id})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def change_blood_direct_request_status(request: HttpRequest, request_id: int, _user=None):
    """Requester updates overall request status or accepts/declines a response.

    Two modes:
      1. Body: { status: fulfilled|cancelled } -> update request status (must be requester)
      2. Body: { response_id, response_status: accepted|declined|cancelled } -> update a specific response
         If accepting a response: request status becomes 'accepted' (unless already fulfilled/cancelled)
    """
    req = query("SELECT * FROM blood_direct_requests WHERE id=%s", [request_id])
    if not req:
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    # response-specific path
    if 'response_id' in data:
        if req['requester_user_id'] != _user['id']:
            return JsonResponse({'error':'forbidden'}, status=403)
        resp_id = int(data.get('response_id'))
        new_r_status = data.get('response_status')
        if new_r_status not in ('accepted','declined','cancelled'):
            return JsonResponse({'error':'invalid_response_status'}, status=400)
        resp = query("SELECT * FROM blood_direct_request_responses WHERE id=%s AND request_id=%s", [resp_id, request_id])
        if not resp:
            return JsonResponse({'error':'response_not_found'}, status=404)
        if resp['status'] in ('accepted','declined') and new_r_status != 'cancelled':
            return JsonResponse({'error':'immutable_response'}, status=400)
        execute("UPDATE blood_direct_request_responses SET status=%s WHERE id=%s", [new_r_status, resp_id])
        # If accepted, set request status=accepted (unless already fulfilled/cancelled)
        if new_r_status == 'accepted' and req['status'] == 'open':
            execute("UPDATE blood_direct_requests SET status='accepted' WHERE id=%s", [request_id])
            try:
                _notify(resp['donor_user_id'], 'blood_direct_response_accepted', {'request_id': request_id, 'response_id': resp_id})
            except Exception:
                pass
        return JsonResponse({'ok': True})
    # request-level status change
    new_status = data.get('status')
    if new_status not in ('fulfilled','cancelled'):
        return JsonResponse({'error':'invalid_status'}, status=400)
    if req['requester_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    if req['status'] in ('fulfilled','cancelled'):
        return JsonResponse({'error':'immutable'}, status=400)
    execute("UPDATE blood_direct_requests SET status=%s WHERE id=%s", [new_status, request_id])
    return JsonResponse({'ok': True})

# ============================= DONOR PROFILES ==================================

VALID_BLOOD_TYPES = {'A+','A-','B+','B-','O+','O-','AB+','AB-'}

@api_view(require_auth=True, methods=['POST'], csrf=False)
def upsert_donor_profile(request: HttpRequest, _user=None):
    """Create or update the authenticated user's donor profile.

    Body: { blood_type, availability_text?, last_donation_date?, notes? }
    Returns: { ok: true }
    """
    data = json.loads(request.body or '{}')
    bt = (data.get('blood_type') or '').upper().strip()
    if bt not in VALID_BLOOD_TYPES:
        return JsonResponse({'error':'invalid_blood_type'}, status=400)
    availability_text = _limit_str(data.get('availability_text') or None, 255)
    last_donation_date = data.get('last_donation_date')  # Expect YYYY-MM-DD
    notes = data.get('notes')
    # Columns cooldown_until and availability_status are defined in the final schema.
    cooldown_until = data.get('cooldown_until')  # optional ISO
    availability_status = data.get('availability_status')  # optional
    # Determine if profile exists
    existing = query("SELECT id FROM donor_profiles WHERE user_id=%s", [_user['id']])
    if existing:
        execute("UPDATE donor_profiles SET blood_type=%s, availability_text=%s, last_donation_date=%s, notes=%s, cooldown_until=COALESCE(%s, cooldown_until), availability_status=COALESCE(%s, availability_status) WHERE user_id=%s", [bt, availability_text, last_donation_date, notes, cooldown_until, availability_status, _user['id']])
    else:
        execute("INSERT INTO donor_profiles(user_id,blood_type,availability_text,last_donation_date,notes,cooldown_until,availability_status) VALUES(%s,%s,%s,%s,%s,%s,%s)", [_user['id'], bt, availability_text, last_donation_date, notes, cooldown_until, availability_status])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def my_donor_profile(request: HttpRequest, _user=None):
    row = query("SELECT user_id,blood_type,availability_text,last_donation_date,notes,cooldown_until,availability_status,created_at,updated_at FROM donor_profiles WHERE user_id=%s", [_user['id']])
    if not row:
        return JsonResponse({'profile': None})
    return JsonResponse({'profile': row})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def set_donor_availability(request: HttpRequest, _user=None):
    """Set donor availability state. Body: { status: 'available'|'cooldown', days? }
    - available: clears cooldown_until
    - cooldown: sets cooldown_until = now + days (default 10)
    """
    data = json.loads(request.body or '{}')
    status = (data.get('status') or '').strip().lower()
    if status not in ('available','cooldown'):
        return JsonResponse({'error':'invalid_status'}, status=400)
    # Columns are present per final schema.
    # Ensure profile exists (must have blood type set first)
    prof = query("SELECT id,blood_type FROM donor_profiles WHERE user_id=%s", [_user['id']])
    if not prof:
        return JsonResponse({'error':'no_profile'}, status=400)
    if status == 'available':
        execute("UPDATE donor_profiles SET availability_status='available', cooldown_until=NULL WHERE user_id=%s", [_user['id']])
        return JsonResponse({'ok': True, 'availability_status':'available'})
    # cooldown path
    try:
        days = int(data.get('days') or 10)
        if days < 0: days = 0
    except Exception:
        days = 10
    # Compute until in Python for portability
    from datetime import datetime, timedelta
    until = (datetime.now() + timedelta(days=days)).strftime('%Y-%m-%d %H:%M:%S')
    execute("UPDATE donor_profiles SET availability_status='cooldown', cooldown_until=%s WHERE user_id=%s", [until, _user['id']])
    return JsonResponse({'ok': True, 'availability_status':'cooldown', 'cooldown_until': until})

@api_view(methods=['GET'], csrf=False)
def donor_profiles_search(request: HttpRequest, _user=None):
    """Public search by blood_type.
    Query params: blood_type (required), limit (<=200)
    """
    bt = (request.GET.get('blood_type') or '').upper().strip()
    if bt not in VALID_BLOOD_TYPES:
        return JsonResponse({'results': []})
    try:
        limit = int(request.GET.get('limit') or 50)
    except Exception:
        limit = 50
    limit = max(1, min(limit, 200))
    rows = query(f"SELECT user_id,blood_type,availability_text,last_donation_date FROM donor_profiles WHERE blood_type=%s ORDER BY updated_at DESC LIMIT {limit}", [bt], many=True) or []
    return JsonResponse({'results': rows})


# ============================= GEO LOCATION (Feature 32) ==============================

@api_view(require_auth=True, methods=['POST'], csrf=False)
def update_location(request: HttpRequest, _user=None):
    """Update the authenticated user's current lat/lng and insert a history record.

    Body: { lat: float, lng: float, source? }
    Effects: updates users.last_lat/last_lng (if columns exist) and inserts row into user_locations.
    Returns: { ok: true }
    """
    data = json.loads(request.body or '{}')
    try:
        lat = float(data.get('lat'))
        lng = float(data.get('lng'))
    except Exception:
        return JsonResponse({'error':'invalid_coordinates'}, status=400)
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return JsonResponse({'error':'out_of_range'}, status=400)
    source = data.get('source')
    # Update user (best-effort; ignore if columns missing)
    try:
        execute("UPDATE users SET last_lat=%s, last_lng=%s WHERE id=%s", [lat, lng, _user['id']])
    except Exception:
        pass
    # Insert history
    try:
        execute("INSERT INTO user_locations(user_id,lat,lng,source) VALUES(%s,%s,%s,%s)", [_user['id'], lat, lng, source])
    except Exception as e:
        return JsonResponse({'error':'persist_failed','detail':str(e)}, status=500)
    # After recording location, opportunistically notify user if within any active crisis radius
    try:
        # Import lazily to avoid circulars and keep this endpoint fast when notifications are disabled
        from .utils import _notify, _ensure_notifications_table
        _ensure_notifications_table()
        # Fetch crises with coordinates; treat 'open' and 'monitoring' as active
        rows = query(
            """
            SELECT c.id AS crisis_id, COALESCE(c.radius_km, 5.0) AS radius_km, i.lat, i.lng
            FROM crises c
            JOIN incidents i ON i.id=c.incident_id
            WHERE i.lat IS NOT NULL AND i.lng IS NOT NULL AND i.status IN ('open','monitoring')
            LIMIT 500
            """,
            [], many=True
        ) or []
        import math
        def hav(a_lat, a_lng, b_lat, b_lng):
            R = 6371.0
            dlat = math.radians(b_lat - a_lat)
            dlng = math.radians(b_lng - a_lng)
            alat = math.radians(a_lat); blat = math.radians(b_lat)
            h = math.sin(dlat/2)**2 + math.cos(alat)*math.cos(blat)*math.sin(dlng/2)**2
            return 2 * R * math.asin(math.sqrt(h))
        # Check each crisis; if within radius, create a notification unless one exists recently
        for r in rows:
            try:
                d = hav(float(r['lat']), float(r['lng']), float(lat), float(lng))
                if d <= float(r['radius_km']) + 1e-6:
                    # De-dupe: avoid spamming same crisis notification if an unread exists from last 24h
                    try:
                        existing = query(
                            """
                            SELECT id FROM notifications
                            WHERE user_id=%s AND type='potential_victim_detected'
                              AND JSON_EXTRACT(payload,'$.crisis_id')=%s AND is_read=0
                              AND created_at >= NOW() - INTERVAL 1 DAY
                            LIMIT 1
                            """,
                            [_user['id'], int(r['crisis_id'])]
                        )
                    except Exception:
                        existing = None
                    if not existing:
                        _notify(_user['id'], 'potential_victim_detected', {
                            'crisis_id': int(r['crisis_id']),
                            'distance_km': round(d, 2),
                        })
            except Exception:
                continue
    except Exception:
        # Non-fatal; location update should still succeed
        pass
    return JsonResponse({'ok': True})

@api_view(methods=['GET'], csrf=False)
def nearby_users(request: HttpRequest, _user=None):
    """Return users near a coordinate within radius_km (default 5km, max 100km).

    Query params: lat, lng, radius_km?
    Returns: { results: [ { user_id, lat, lng, distance_km } ] }
    Implementation: Uses latest user_locations row per user (by captured_at) via subquery, then Python post-filter for accuracy.
    """
    try:
        lat = float(request.GET.get('lat'))
        lng = float(request.GET.get('lng'))
    except Exception:
        return JsonResponse({'error':'invalid_coordinates'}, status=400)
    try:
        radius_km = float(request.GET.get('radius_km') or 5.0)
    except Exception:
        radius_km = 5.0
    # Allow larger search radii (up to 500km) to accommodate broader queries in tests / future features.
    radius_km = max(0.1, min(radius_km, 500.0))
    # Rough bounding box to limit candidate set (1 deg lat ~=111km, lng scales by cos(lat))
    lat_delta = radius_km / 111.0
    import math
    lng_delta = radius_km / (111.0 * max(math.cos(math.radians(lat)), 0.0001))
    min_lat, max_lat = lat - lat_delta, lat + lat_delta
    min_lng, max_lng = lng - lng_delta, lng + lng_delta
    # Pull latest location per user using self-join for max captured_at
    rows = query(
        """
        SELECT Distinct ul.user_id, ul.lat, ul.lng, ul.captured_at
        FROM user_locations ul
        JOIN users u ON u.id = ul.user_id
        WHERE u.role IN ('regular','admin')
          AND ul.id = (
              SELECT ul2.id
              FROM user_locations ul2
              WHERE ul2.user_id = ul.user_id
              ORDER BY ul2.captured_at DESC, ul2.id DESC
              LIMIT 1
          )
          AND ul.lat BETWEEN %s AND %s
          AND ul.lng BETWEEN %s AND %s
        LIMIT 500
        """,
        [min_lat, max_lat, min_lng, max_lng], many=True
    ) or []
    # Haversine filter
    def hav(a_lat, a_lng, b_lat, b_lng):
        R = 6371.0
        dlat = math.radians(b_lat - a_lat)
        dlng = math.radians(b_lng - a_lng)
        alat = math.radians(a_lat); blat = math.radians(b_lat)
        h = math.sin(dlat/2)**2 + math.cos(alat)*math.cos(blat)*math.sin(dlng/2)**2
        return 2 * R * math.asin(math.sqrt(h))
    results = []
    for r in rows:
        d = hav(lat, lng, float(r['lat']), float(r['lng']))
        if d <= radius_km + 1e-6:
            results.append({'user_id': r['user_id'], 'lat': float(r['lat']), 'lng': float(r['lng']), 'distance_km': round(d, 2)})
    # Sort by distance
    results.sort(key=lambda x: x['distance_km'])
    return JsonResponse({'results': results[:100], 'count': len(results[:100])})

# ============================= CRISIS BLOOD BANK INTEGRATIONS ==============================

@api_view(require_auth=True, methods=['GET'], csrf=False)
def crisis_blood_donors_list(request: HttpRequest, crisis_id: int, _user=None):
    """List crisis-linked donors for the calling blood bank user. Admin can view all by ?all=1."""
    _ensure_crisis_tables()
    cr = query("SELECT incident_id FROM crises WHERE id=%s", [crisis_id])
    if not cr:
        return JsonResponse({'error':'not_found'}, status=404)
    is_admin = _require_admin(_user)
    if not is_admin and not _require_blood_bank(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    # Must be a participant of the incident unless admin
    if not is_admin:
        part = query("SELECT id FROM incident_participants WHERE incident_id=%s AND user_id=%s AND status='active'", [cr['incident_id'], _user['id']])
        if not part:
            return JsonResponse({'error':'forbidden'}, status=403)
    all_flag = str(request.GET.get('all') or '').lower() in ('1','true','yes')
    if is_admin and all_flag:
        rows = query(
            """
            SELECT cbd.id, cbd.bank_user_id, cbd.donor_user_id, cbd.blood_type, cbd.notes, cbd.created_at,
                   u.full_name AS donor_name, u.email AS donor_email
            FROM crisis_blood_donors cbd
            LEFT JOIN users u ON u.id = cbd.donor_user_id
            WHERE cbd.crisis_id=%s
            ORDER BY cbd.id DESC
            """,
            [crisis_id], many=True
        ) or []
    else:
        rows = query(
            """
            SELECT cbd.id, cbd.bank_user_id, cbd.donor_user_id, cbd.blood_type, cbd.notes, cbd.created_at,
                   u.full_name AS donor_name, u.email AS donor_email
            FROM crisis_blood_donors cbd
            LEFT JOIN users u ON u.id = cbd.donor_user_id
            WHERE cbd.crisis_id=%s AND cbd.bank_user_id=%s
            ORDER BY cbd.id DESC
            """,
            [crisis_id, _user['id']], many=True
        ) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_blood_donors_add(request: HttpRequest, crisis_id: int, _user=None):
    """Blood bank user links one of their donors to the crisis (or arbitrary user id).
    Body: { donor_user_id, blood_type?, notes? }
    If blood_type omitted, attempts to use bank donor record blood_type.
    """
    _ensure_crisis_tables(); _ensure_blood_bank_tables()
    ok, err = _require_crisis_open(crisis_id)
    if not ok:
        return err
    cr = query("SELECT incident_id FROM crises WHERE id=%s", [crisis_id])
    if not cr:
        return JsonResponse({'error':'not_found'}, status=404)
    if not (_require_admin(_user) or _require_blood_bank(_user)):
        return JsonResponse({'error':'forbidden'}, status=403)
    # Must be incident participant when bank user
    if not _require_admin(_user):
        part = query("SELECT id FROM incident_participants WHERE incident_id=%s AND user_id=%s AND status='active'", [cr['incident_id'], _user['id']])
        if not part:
            return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    try:
        donor_user_id = int(data.get('donor_user_id'))
    except Exception:
        return JsonResponse({'error':'invalid_donor'}, status=400)
    # Determine blood type
    bt = (data.get('blood_type') or '').upper().strip()
    if not bt:
        link = query("SELECT blood_type FROM blood_bank_donors WHERE bank_user_id=%s AND user_id=%s", [_user['id'], donor_user_id])
        bt = (link or {}).get('blood_type')
    if not bt or bt not in VALID_BLOOD_TYPES:
        return JsonResponse({'error':'invalid_blood_type'}, status=400)
    notes = _limit_str(data.get('notes') or None, 500) if data.get('notes') else None
    try:
        cid = execute(
            "INSERT INTO crisis_blood_donors(crisis_id,bank_user_id,donor_user_id,blood_type,notes) VALUES(%s,%s,%s,%s,%s)",
            [crisis_id, _user['id'], donor_user_id, bt, notes]
        )
    except Exception as e:
        existing = query("SELECT id FROM crisis_blood_donors WHERE crisis_id=%s AND bank_user_id=%s AND donor_user_id=%s", [crisis_id, _user['id'], donor_user_id])
        if existing:
            return JsonResponse({'id': existing['id'], 'ok': True, 'detail': 'already_added'})
        return JsonResponse({'error':'db_error','detail':str(e)}, status=500)
    # Log activity
    try:
        execute("INSERT INTO incident_events(incident_id,user_id,event_type,note) VALUES(%s,%s,'note',%s)", [cr['incident_id'], _user['id'], f"[Blood Bank] Linked donor #{donor_user_id} ({bt}) to crisis"])
    except Exception:
        pass
    return JsonResponse({'id': cid})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_blood_donors_remove(request: HttpRequest, crisis_id: int, crisis_donor_id: int, _user=None):
    _ensure_crisis_tables()
    row = query("SELECT * FROM crisis_blood_donors WHERE id=%s AND crisis_id=%s", [crisis_donor_id, crisis_id])
    if not row:
        return JsonResponse({'error':'not_found'}, status=404)
    if not (_require_admin(_user) or (_require_blood_bank(_user) and row['bank_user_id']==_user['id'])):
        return JsonResponse({'error':'forbidden'}, status=403)
    execute("DELETE FROM crisis_blood_donors WHERE id=%s", [crisis_donor_id])
    try:
        inc = query("SELECT incident_id FROM crises WHERE id=%s", [crisis_id]) or {}
        execute("INSERT INTO incident_events(incident_id,user_id,event_type,note) VALUES(%s,%s,'note',%s)", [inc.get('incident_id'), _user['id'], f"[Blood Bank] Unlinked donor #{row['donor_user_id']}"])
    except Exception:
        pass
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['GET','POST'], csrf=False)
def crisis_blood_allocations(request: HttpRequest, crisis_id: int, _user=None):
    """GET: list allocations (bank sees own; admin can pass all=1)
       POST: create allocation from inventory { blood_type, quantity_units, purpose? }
    """
    _ensure_crisis_tables(); _ensure_blood_bank_tables()
    ok, err = _require_crisis_open(crisis_id)
    if not ok:
        return err
    cr = query("SELECT incident_id FROM crises WHERE id=%s", [crisis_id])
    if not cr:
        return JsonResponse({'error':'not_found'}, status=404)
    is_admin = _require_admin(_user)
    if request.method == 'GET':
        if not (is_admin or _require_blood_bank(_user)):
            return JsonResponse({'error':'forbidden'}, status=403)
        if not is_admin:
            part = query("SELECT id FROM incident_participants WHERE incident_id=%s AND user_id=%s AND status='active'", [cr['incident_id'], _user['id']])
            if not part:
                return JsonResponse({'error':'forbidden'}, status=403)
        all_flag = str(request.GET.get('all') or '').lower() in ('1','true','yes')
        if is_admin and all_flag:
            rows = query(
                "SELECT * FROM crisis_blood_allocations WHERE crisis_id=%s ORDER BY id DESC",
                [crisis_id], many=True
            ) or []
        else:
            rows = query(
                "SELECT * FROM crisis_blood_allocations WHERE crisis_id=%s AND bank_user_id=%s ORDER BY id DESC",
                [crisis_id, _user['id']], many=True
            ) or []
        return JsonResponse({'results': rows})
    # POST create allocation
    if not (_require_blood_bank(_user) or is_admin):
        return JsonResponse({'error':'forbidden'}, status=403)
    if not is_admin:
        part = query("SELECT id FROM incident_participants WHERE incident_id=%s AND user_id=%s AND status='active'", [cr['incident_id'], _user['id']])
        if not part:
            return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    bt = (data.get('blood_type') or '').upper().strip()
    try:
        qty = int(data.get('quantity_units') or 0)
    except Exception:
        return JsonResponse({'error':'invalid_quantity'}, status=400)
    if bt not in VALID_BLOOD_TYPES:
        return JsonResponse({'error':'invalid_blood_type'}, status=400)
    if qty < 1:
        return JsonResponse({'error':'invalid_quantity'}, status=400)
    # Check inventory and decrement
    inv = query("SELECT id, quantity_units FROM blood_inventory WHERE bank_user_id=%s AND blood_type=%s", [_user['id'], bt])
    if not inv or int(inv['quantity_units']) < qty:
        return JsonResponse({'error':'insufficient_inventory'}, status=400)
    execute("UPDATE blood_inventory SET quantity_units=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s", [int(inv['quantity_units']) - qty, inv['id']])
    purpose = data.get('purpose')
    aid = execute(
        "INSERT INTO crisis_blood_allocations(crisis_id,bank_user_id,blood_type,quantity_units,purpose) VALUES(%s,%s,%s,%s,%s)",
        [crisis_id, _user['id'], bt, qty, purpose]
    )
    # Log activity
    try:
        execute("INSERT INTO incident_events(incident_id,user_id,event_type,note) VALUES(%s,%s,'note',%s)", [cr['incident_id'], _user['id'], f"[Blood Bank] Allocated {qty} units of {bt} to crisis"])
    except Exception:
        pass
    return JsonResponse({'id': aid})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_blood_allocation_update(request: HttpRequest, crisis_id: int, allocation_id: int, _user=None):
    _ensure_crisis_tables(); _ensure_blood_bank_tables()
    ok, err = _require_crisis_open(crisis_id)
    if not ok:
        return err
    row = query("SELECT * FROM crisis_blood_allocations WHERE id=%s AND crisis_id=%s", [allocation_id, crisis_id])
    if not row:
        return JsonResponse({'error':'not_found'}, status=404)
    if not (_require_admin(_user) or (_require_blood_bank(_user) and row['bank_user_id']==_user['id'])):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    fields = {}
    if 'purpose' in data:
        fields['purpose'] = data.get('purpose')
    if 'status' in data and data.get('status') in ('allocated','reverted'):
        new_status = data.get('status')
        if row['status'] != new_status and new_status == 'reverted':
            # restore inventory
            inv = query("SELECT id,quantity_units FROM blood_inventory WHERE bank_user_id=%s AND blood_type=%s", [row['bank_user_id'], row['blood_type']])
            if inv:
                execute("UPDATE blood_inventory SET quantity_units=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s", [int(inv['quantity_units']) + int(row['quantity_units']), inv['id']])
            else:
                execute("INSERT INTO blood_inventory(bank_user_id,blood_type,quantity_units) VALUES(%s,%s,%s)", [row['bank_user_id'], row['blood_type'], int(row['quantity_units'])])
            fields['status'] = 'reverted'
    if not fields:
        return JsonResponse({'ok': True})
    sets = ",".join([f"{k}=%s" for k in fields.keys()])
    params = list(fields.values()) + [allocation_id]
    execute(f"UPDATE crisis_blood_allocations SET {sets} WHERE id=%s", params)
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_blood_allocation_delete(request: HttpRequest, crisis_id: int, allocation_id: int, _user=None):
    _ensure_crisis_tables(); _ensure_blood_bank_tables()
    ok, err = _require_crisis_open(crisis_id)
    if not ok:
        return err
    row = query("SELECT * FROM crisis_blood_allocations WHERE id=%s AND crisis_id=%s", [allocation_id, crisis_id])
    if not row:
        return JsonResponse({'error':'not_found'}, status=404)
    if not (_require_admin(_user) or (_require_blood_bank(_user) and row['bank_user_id']==_user['id'])):
        return JsonResponse({'error':'forbidden'}, status=403)
    # restore inventory if still allocated
    if row['status'] == 'allocated':
        inv = query("SELECT id,quantity_units FROM blood_inventory WHERE bank_user_id=%s AND blood_type=%s", [row['bank_user_id'], row['blood_type']])
        if inv:
            execute("UPDATE blood_inventory SET quantity_units=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s", [int(inv['quantity_units']) + int(row['quantity_units']), inv['id']])
        else:
            execute("INSERT INTO blood_inventory(bank_user_id,blood_type,quantity_units) VALUES(%s,%s,%s)", [row['bank_user_id'], row['blood_type'], int(row['quantity_units'])])
    execute("DELETE FROM crisis_blood_allocations WHERE id=%s", [allocation_id])
    return JsonResponse({'ok': True})


# ============================= BLOOD DIRECT REQUESTS (Feature 10) ========================

DIRECT_REQUEST_STATUSES = {'open','accepted','fulfilled','cancelled'}
DIRECT_RESPONSE_STATUSES = {'pending','accepted','declined','cancelled'}

def _validate_blood_type(bt: str):
    return bt in VALID_BLOOD_TYPES

@api_view(require_auth=True, methods=['POST'], csrf=False)
def create_blood_direct_request(request: HttpRequest, _user=None):
    """Create a direct blood donor request.

    Body: { target_blood_type, quantity_units?, notes? }
    Any authenticated user may create (acts as requester). A donor later responds.
    """
    data = json.loads(request.body or '{}')
    bt = (data.get('target_blood_type') or '').upper().strip()
    if not _validate_blood_type(bt):
        return JsonResponse({'error':'invalid_blood_type'}, status=400)
    try:
        qty = int(data.get('quantity_units') or 1)
    except Exception:
        return JsonResponse({'error':'invalid_quantity'}, status=400)
    notes = _limit_str(data.get('notes') or None, 500) if data.get('notes') else None
    rid = execute("INSERT INTO blood_direct_requests(requester_user_id,target_blood_type,quantity_units,notes) VALUES(%s,%s,%s,%s)", [_user['id'], bt, qty, notes])
    return JsonResponse({'id': rid})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def change_blood_direct_request_status(request: HttpRequest, request_id: int, _user=None):
    """Requester actions:
    Body options:
        { status: 'cancelled' } (from open or accepted)
        { status: 'fulfilled' } (only from accepted)
        { accept_response_id: X } (from open -> accepted)
    Accepting a response will:
        - set request.status = accepted
        - set that response.status = accepted
        - set other pending responses to declined
        - notify the accepted donor
    """
    dr = query("SELECT * FROM blood_direct_requests WHERE id=%s", [request_id])
    if not dr:
        return JsonResponse({'error':'not_found'}, status=404)
    if dr['requester_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    accept_id = data.get('accept_response_id')
    new_status = data.get('status')
    if accept_id:
        if dr['status'] != 'open':
            return JsonResponse({'error':'invalid_state'}, status=400)
        resp = query("SELECT * FROM blood_direct_request_responses WHERE id=%s AND request_id=%s", [accept_id, request_id])
        if not resp:
            return JsonResponse({'error':'response_not_found'}, status=404)
        if resp['status'] != 'pending':
            return JsonResponse({'error':'response_not_pending'}, status=400)
        execute("UPDATE blood_direct_requests SET status='accepted' WHERE id=%s", [request_id])
        execute("UPDATE blood_direct_request_responses SET status='accepted' WHERE id=%s", [accept_id])
        # decline others
        execute("UPDATE blood_direct_request_responses SET status='declined' WHERE request_id=%s AND id!=%s AND status='pending'", [request_id, accept_id])
        try:
            _notify(resp['donor_user_id'], 'direct_request_accepted', {'request_id': request_id, 'response_id': accept_id})
        except Exception:
            pass
        return JsonResponse({'ok': True, 'status': 'accepted'})
    if new_status:
        if new_status not in ('cancelled','fulfilled'):
            return JsonResponse({'error':'invalid_status'}, status=400)
        if new_status == 'fulfilled' and dr['status'] != 'accepted':
            return JsonResponse({'error':'invalid_transition'}, status=400)
        if new_status == 'cancelled' and dr['status'] not in ('open','accepted'):
            return JsonResponse({'error':'invalid_transition'}, status=400)
        execute("UPDATE blood_direct_requests SET status=%s WHERE id=%s", [new_status, request_id])
        return JsonResponse({'ok': True, 'status': new_status})
    return JsonResponse({'error':'no_action'}, status=400)



# ============================= PHASE 3: CAMPAIGNS ==============================

ALLOWED_CAMPAIGN_CREATOR_ROLES = {'hospital','social_org','fire_service','blood_bank','admin','ngo','social_service','org'}
CAMPAIGN_STATUSES = {'draft','active','completed','cancelled'}
CAMPAIGN_STATUS_TRANSITIONS = {
    'draft': {'active','cancelled'},
    'active': {'completed','cancelled'},
    'completed': set(),
    'cancelled': set(),
}

def _can_create_campaign(user):
    return user and user.get('role') in ALLOWED_CAMPAIGN_CREATOR_ROLES

def _ensure_campaigns_table():
    # No-op: schema is managed by final_normalized_schema.sql
    return None

def _has_column(table: str, column: str) -> bool:
    """Return True if a given column exists in the current DB schema."""
    try:
        row = query(
            """
            SELECT COUNT(*) AS c
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME=%s AND COLUMN_NAME=%s
            """,
            [table, column]
        )
        return bool(row and int(row.get('c') or 0) > 0)
    except Exception:
        return False

@api_view(require_auth=True, methods=['POST'], csrf=False)
def create_campaign(request: HttpRequest, _user=None):
    """Create a campaign (draft by default) by eligible org role.

    Body: { title, description?, campaign_type?, starts_at?, ends_at?, location_text?, target_metric?, target_value? }
    Returns: { id }
    """
    _ensure_campaigns_table()
    if not _can_create_campaign(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    title = _limit_str(data.get('title','').strip(), 200)
    if not title:
        return JsonResponse({'error':'missing_title'}, status=400)
    description = data.get('description')
    ctype = _limit_str(data.get('campaign_type','general'), 50)
    starts_at = data.get('starts_at')
    ends_at = data.get('ends_at')
    location_text = _limit_str(data.get('location_text',''),255)
    target_metric = _limit_str(data.get('target_metric','') or None, 50) if data.get('target_metric') else None
    target_value = data.get('target_value')
    try:
        if target_value is not None:
            target_value = int(target_value)
    except Exception:
        return JsonResponse({'error':'invalid_target_value'}, status=400)
    # Some environments may not have the optional 'campaign_type' column; handle gracefully
    if _has_column('campaigns', 'campaign_type'):
        cid = execute(
            "INSERT INTO campaigns(owner_user_id,title,description,campaign_type,starts_at,ends_at,location_text,target_metric,target_value) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            [_user['id'], title, description, ctype, starts_at, ends_at, location_text, target_metric, target_value]
        )
    else:
        cid = execute(
            "INSERT INTO campaigns(owner_user_id,title,description,starts_at,ends_at,location_text,target_metric,target_value) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)",
            [_user['id'], title, description, starts_at, ends_at, location_text, target_metric, target_value]
        )
    return JsonResponse({'id': cid})

@api_view(methods=['GET'], csrf=False)
def list_campaigns(request: HttpRequest, _user=None):
    """List campaigns with optional filters: status, type, owner_user_id.
    Draft campaigns only visible to their owner.
    Query params: status, campaign_type, owner, q (substring in title)
    """
    _ensure_campaigns_table()
    status_f = request.GET.get('status')
    ctype = request.GET.get('campaign_type')
    owner = request.GET.get('owner')
    q = request.GET.get('q')
    where = []
    params = []
    if status_f:
        where.append('status=%s'); params.append(status_f)
    if ctype and _has_column('campaigns','campaign_type'):
        where.append('campaign_type=%s'); params.append(ctype)
    if owner:
        where.append('owner_user_id=%s'); params.append(owner)
    if q:
        where.append('title LIKE %s'); params.append(f"%{q}%")
    # Visibility rule: hide draft unless owner
    if not (status_f == 'draft' and owner and _user and str(_user['id'])==str(owner)):
        where.append("(status!='draft' OR owner_user_id=%s)"); params.append(_user['id'] if _user else 0)
    sql = 'SELECT * FROM campaigns'
    if where:
        sql += ' WHERE ' + ' AND '.join(where)
    sql += ' ORDER BY created_at DESC LIMIT 200'
    rows = query(sql, params, many=True) or []
    return JsonResponse({'results': rows})

@api_view(methods=['GET'], csrf=False)
def get_campaign(request: HttpRequest, campaign_id: int, _user=None):
    _ensure_campaigns_table()
    row = query("SELECT * FROM campaigns WHERE id=%s", [campaign_id])
    if not row:
        return JsonResponse({'error':'not_found'}, status=404)
    # draft visibility
    if row['status']=='draft' and (not _user or row['owner_user_id'] != _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    return JsonResponse(row)

@api_view(require_auth=True, methods=['PUT'], csrf=False)
def update_campaign(request: HttpRequest, campaign_id: int, _user=None):
    _ensure_campaigns_table()
    camp = query("SELECT * FROM campaigns WHERE id=%s", [campaign_id])
    if not camp:
        return JsonResponse({'error':'not_found'}, status=404)
    if camp['owner_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    if camp['status'] in ('completed','cancelled'):
        return JsonResponse({'error':'immutable_status'}, status=400)
    data = json.loads(request.body or '{}')
    has_ct = _has_column('campaigns','campaign_type')
    fields = {
        'title': _limit_str(data.get('title', camp.get('title')), 200),
        'description': data.get('description', camp.get('description')),
        'starts_at': data.get('starts_at', camp.get('starts_at')),
        'ends_at': data.get('ends_at', camp.get('ends_at')),
        'location_text': _limit_str(data.get('location_text', camp.get('location_text') or ''),255),
        'target_metric': _limit_str(data.get('target_metric', camp.get('target_metric') or '') or None,50),
        'target_value': data.get('target_value', camp.get('target_value')),
        'current_value': data.get('current_value', camp.get('current_value')),
    }
    if has_ct:
        fields['campaign_type'] = _limit_str(data.get('campaign_type', camp.get('campaign_type')),50)
    try:
        if fields['target_value'] is not None:
            fields['target_value'] = int(fields['target_value'])
        if fields['current_value'] is not None:
            fields['current_value'] = int(fields['current_value'])
    except Exception:
        return JsonResponse({'error':'invalid_numeric'}, status=400)
    # Build dynamic UPDATE depending on column presence
    set_parts = [
        'title=%s', 'description=%s',
        'starts_at=%s', 'ends_at=%s', 'location_text=%s',
        'target_metric=%s', 'target_value=%s', 'current_value=%s'
    ]
    params = [
        fields['title'], fields['description'],
        fields['starts_at'], fields['ends_at'], fields['location_text'],
        fields['target_metric'], fields['target_value'], fields['current_value']
    ]
    if has_ct:
        set_parts.insert(2, 'campaign_type=%s')
        params.insert(2, fields.get('campaign_type'))
    execute("UPDATE campaigns SET " + ", ".join(set_parts) + " WHERE id=%s", params + [campaign_id])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def change_campaign_status(request: HttpRequest, campaign_id: int, _user=None):
    _ensure_campaigns_table()
    camp = query("SELECT * FROM campaigns WHERE id=%s", [campaign_id])
    if not camp:
        return JsonResponse({'error':'not_found'}, status=404)
    if camp['owner_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    new_status = data.get('status')
    if new_status not in CAMPAIGN_STATUSES:
        return JsonResponse({'error':'invalid_status'}, status=400)
    allowed = CAMPAIGN_STATUS_TRANSITIONS.get(camp['status'], set())
    if new_status not in allowed:
        return JsonResponse({'error':'invalid_transition','from':camp['status'],'to':new_status}, status=400)
    execute("UPDATE campaigns SET status=%s WHERE id=%s", [new_status, campaign_id])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def join_campaign(request: HttpRequest, campaign_id: int, _user=None):
    _ensure_campaigns_table()
    camp = query("SELECT * FROM campaigns WHERE id=%s", [campaign_id])
    if not camp:
        return JsonResponse({'error':'not_found'}, status=404)
    if camp['status'] != 'active':
        return JsonResponse({'error':'not_joinable'}, status=400)
    if camp['owner_user_id'] == _user['id']:
        return JsonResponse({'error':'owner_cannot_join'}, status=400)
    existing = query("SELECT id,status,role_label FROM campaign_participants WHERE campaign_id=%s AND user_id=%s", [campaign_id, _user['id']])
    if existing:
        status_now = str(existing.get('status') or '').lower()
        if status_now in ('withdrawn','rejected'):
            # Re-request participation as pending
            execute("UPDATE campaign_participants SET status='pending' WHERE id=%s", [existing['id']])
            try:
                from .utils import _ensure_notifications_table
                _ensure_notifications_table()
            except Exception:
                pass
            try:
                _notify(camp['owner_user_id'], 'campaign_participated', {
                    'campaign_id': campaign_id,
                    'campaign_title': camp.get('title'),
                    'participant_user_id': _user['id'],
                    'participant_name': _user.get('full_name') or _user.get('email'),
                    'role_label': role_label,
                    'rejoined': True,
                })
            except Exception:
                pass
            return JsonResponse({'id': existing['id'], 'rejoined': True, 'status': 'pending'})
        if status_now == 'pending':
            return JsonResponse({'error':'already_pending'}, status=400)
        # accepted or any other active-like status
        return JsonResponse({'error':'already_participating'}, status=400)
    data = json.loads(request.body or '{}')
    role_label = _limit_str(data.get('role_label','') or None,50) if data.get('role_label') else None
    # New requests join as 'pending' by default; owner must accept
    pid = execute("INSERT INTO campaign_participants(campaign_id,user_id,role_label,status) VALUES(%s,%s,%s,'pending')", [campaign_id, _user['id'], role_label])
    # Notify owner about new participant
    try:
        from .utils import _ensure_notifications_table
        _ensure_notifications_table()
    except Exception:
        pass
    try:
        _notify(camp['owner_user_id'], 'campaign_participated', {
            'campaign_id': campaign_id,
            'campaign_title': camp.get('title'),
            'participant_user_id': _user['id'],
            'participant_name': _user.get('full_name') or _user.get('email'),
            'role_label': role_label,
            'rejoined': False,
        })
    except Exception:
        pass
    return JsonResponse({'id': pid})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def withdraw_campaign(request: HttpRequest, campaign_id: int, _user=None):
    _ensure_campaigns_table()
    row = query("SELECT id,status FROM campaign_participants WHERE campaign_id=%s AND user_id=%s", [campaign_id, _user['id']])
    if not row:
        return JsonResponse({'error':'not_participant'}, status=404)
    if row['status'] in ('withdrawn','rejected'):
        return JsonResponse({'ok': True, 'already': True})
    execute("UPDATE campaign_participants SET status='withdrawn' WHERE id=%s", [row['id']])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_campaign_participants(request: HttpRequest, campaign_id: int, _user=None):
    _ensure_campaigns_table()
    camp = query("SELECT owner_user_id,status FROM campaigns WHERE id=%s", [campaign_id])
    if not camp:
        return JsonResponse({'error':'not_found'}, status=404)
    if camp['status']=='draft' and (not _user or camp['owner_user_id'] != _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    from .utils import paginate
    owner_view = _user and camp['owner_user_id'] == _user['id']
    if owner_view:
        base = "SELECT id,user_id,role_label,status,joined_at FROM campaign_participants WHERE campaign_id=%s"
        params = [campaign_id]
    else:
        # Show accepted participants to everyone; also show the caller's own row (pending/rejected/withdrawn) so they can see their status
        base = "SELECT id,user_id,role_label,status,joined_at FROM campaign_participants WHERE campaign_id=%s AND (status='accepted' OR user_id=%s)"
        params = [campaign_id, (_user['id'] if _user else 0)]
    rows, meta = paginate(request, base, params, order_fragment=' ORDER BY joined_at ASC')
    return JsonResponse({'results': rows, **meta})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def update_campaign_participant_status(request: HttpRequest, campaign_id: int, participant_id: int, _user=None):
    _ensure_campaigns_table()
    camp = query("SELECT owner_user_id FROM campaigns WHERE id=%s", [campaign_id])
    if not camp:
        return JsonResponse({'error':'not_found'}, status=404)
    if camp['owner_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    part = query("SELECT * FROM campaign_participants WHERE id=%s AND campaign_id=%s", [participant_id, campaign_id])
    if not part:
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    sets = []
    params = []
    # Optional role change
    if 'role_label' in data:
        rl = _limit_str((data.get('role_label') or '') or None, 50) if data.get('role_label') else None
        sets.append('role_label=%s'); params.append(rl)
    # Optional status change
    new_status = data.get('status') if 'status' in data else None
    if new_status is not None:
        if new_status not in ('accepted','rejected','withdrawn'):
            return JsonResponse({'error':'invalid_status'}, status=400)
        sets.append('status=%s'); params.append(new_status)
    if not sets:
        return JsonResponse({'error':'no_fields'}, status=400)
    params.append(participant_id)
    execute("UPDATE campaign_participants SET "+','.join(sets)+" WHERE id=%s", params)
    if new_status is not None:
        try:
            _notify(part['user_id'], 'campaign_participation_status', {'campaign_id': campaign_id, 'status': new_status})
        except Exception:
            pass
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['DELETE'], csrf=False)
def delete_campaign_participant(request: HttpRequest, campaign_id: int, participant_id: int, _user=None):
    """Owner-only hard delete of a participant record.
    This permanently removes the participant row instead of toggling status.
    """
    _ensure_campaigns_table()
    camp = query("SELECT owner_user_id FROM campaigns WHERE id=%s", [campaign_id])
    if not camp:
        return JsonResponse({'error':'not_found'}, status=404)
    if camp['owner_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    part = query("SELECT id FROM campaign_participants WHERE id=%s AND campaign_id=%s", [participant_id, campaign_id])
    if not part:
        return JsonResponse({'error':'not_found'}, status=404)
    execute("DELETE FROM campaign_participants WHERE id=%s", [participant_id])
    return JsonResponse({'ok': True, 'deleted': True})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def my_campaigns(request: HttpRequest, _user=None):
    _ensure_campaigns_table()
    rows = query("SELECT * FROM campaigns WHERE owner_user_id=%s ORDER BY created_at DESC", [_user['id']], many=True) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def my_campaign_participations(request: HttpRequest, _user=None):
    _ensure_campaigns_table()
    rows = query("SELECT c.*, cp.status AS participation_status, cp.role_label, cp.id AS participation_id FROM campaign_participants cp JOIN campaigns c ON c.id=cp.campaign_id WHERE cp.user_id=%s ORDER BY cp.joined_at DESC", [_user['id']], many=True) or []
    return JsonResponse({'results': rows})

# ============================= SOCIAL ORG VOLUNTEERS ==============================

def _require_org_owner(org_id: int, user_id: int) -> bool:
    row = query("SELECT id FROM social_organizations WHERE id=%s AND user_id=%s", [org_id, user_id])
    return bool(row)

def _ensure_social_org_volunteers_table():
    # No-op: final schema ensures social_org_volunteers exists.
    return None

@api_view(methods=['GET'], csrf=False)
def social_org_list_volunteers(request: HttpRequest, org_id: int, _user=None):
    _ensure_social_org_volunteers_table()
    owner_view = _user and _require_org_owner(org_id, _user['id'])
    if owner_view:
        rows = query(
            """
            SELECT v.id,v.user_id,v.role_label,v.status,v.created_at,
                   u.email AS user_email, u.full_name AS user_full_name
            FROM social_org_volunteers v LEFT JOIN users u ON u.id=v.user_id
            WHERE v.org_id=%s
            ORDER BY v.id DESC
            """,
            [org_id], many=True
        ) or []
    else:
        rows = query(
            """
            SELECT v.id,v.user_id,v.role_label,v.status,v.created_at,
                   u.full_name AS user_full_name
            FROM social_org_volunteers v LEFT JOIN users u ON u.id=v.user_id
            WHERE v.org_id=%s AND v.status='accepted'
            ORDER BY v.id DESC
            """,
            [org_id], many=True
        ) or []
    return JsonResponse({'results': rows, 'owner_view': bool(owner_view)})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def social_org_add_volunteer(request: HttpRequest, org_id: int, _user=None):
    if not _require_org_owner(org_id, _user['id']):
        return JsonResponse({'error': 'forbidden'}, status=403)
    _ensure_social_org_volunteers_table()
    data = json.loads(request.body or '{}')
    user_id = int(data.get('user_id') or 0)
    role_label = _limit_str(data.get('role_label','') or None, 64) if data.get('role_label') else None
    status = data.get('status') or 'accepted'
    if not user_id:
        return JsonResponse({'error':'missing_user_id'}, status=400)
    existing = query("SELECT id FROM social_org_volunteers WHERE org_id=%s AND user_id=%s", [org_id, user_id])
    if existing:
        # Update role/status if provided
        sets=[]; params=[]
        if role_label is not None:
            sets.append('role_label=%s'); params.append(role_label)
        if status in ('pending','accepted','rejected','removed'):
            sets.append('status=%s'); params.append(status)
        if sets:
            params.append(existing['id'])
            execute("UPDATE social_org_volunteers SET "+','.join(sets)+" WHERE id=%s", params)
        return JsonResponse({'id': existing['id'], 'updated': True})
    vid = execute("INSERT INTO social_org_volunteers(org_id,user_id,role_label,status) VALUES(%s,%s,%s,%s)", [org_id, user_id, role_label, status])
    return JsonResponse({'id': vid})

@api_view(require_auth=True, methods=['POST','DELETE'], csrf=False)
def social_org_volunteer_item(request: HttpRequest, org_id: int, volunteer_id: int, _user=None):
    if not _require_org_owner(org_id, _user['id']):
        return JsonResponse({'error': 'forbidden'}, status=403)
    _ensure_social_org_volunteers_table()
    vol = query("SELECT id FROM social_org_volunteers WHERE id=%s AND org_id=%s", [volunteer_id, org_id])
    if not vol:
        return JsonResponse({'error':'not_found'}, status=404)
    if request.method == 'DELETE':
        try:
            execute("DELETE FROM social_org_volunteers WHERE id=%s", [volunteer_id])
        except Exception:
            # Soft-remove if FK prevents delete
            try:
                execute("UPDATE social_org_volunteers SET status='removed' WHERE id=%s", [volunteer_id])
            except Exception:
                return JsonResponse({'error':'delete_failed'}, status=500)
        return JsonResponse({'ok': True})
    # POST = update
    data = json.loads(request.body or '{}')
    sets=[]; params=[]
    if 'role_label' in data:
        rl = _limit_str((data.get('role_label') or '') or None, 64) if data.get('role_label') else None
        sets.append('role_label=%s'); params.append(rl)
    if 'status' in data:
        st = data.get('status')
        if st not in ('pending','accepted','rejected','removed'):
            return JsonResponse({'error':'invalid_status'}, status=400)
        sets.append('status=%s'); params.append(st)
    if sets:
        params.append(volunteer_id)
        execute("UPDATE social_org_volunteers SET "+','.join(sets)+" WHERE id=%s", params)
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def social_org_apply_to_volunteer(request: HttpRequest, org_id: int, _user=None):
    _ensure_social_org_volunteers_table()
    # Allow any user to apply; create or update to pending for self
    existing = query("SELECT id,status FROM social_org_volunteers WHERE org_id=%s AND user_id=%s", [org_id, _user['id']])
    if existing:
        if existing.get('status') == 'pending':
            return JsonResponse({'ok': True, 'already': True, 'status': 'pending'})
        execute("UPDATE social_org_volunteers SET status='pending' WHERE id=%s", [existing['id']])
        return JsonResponse({'ok': True, 'reapplied': True})
    vid = execute("INSERT INTO social_org_volunteers(org_id,user_id,status) VALUES(%s,%s,'pending')", [org_id, _user['id']])
    return JsonResponse({'id': vid, 'status': 'pending'})

# ============================= CAMPAIGN: ADD VOLUNTEERS ==============================

@api_view(require_auth=True, methods=['POST'], csrf=False)
def campaigns_add_volunteers(request: HttpRequest, campaign_id: int, _user=None):
    camp = query("SELECT owner_user_id,status FROM campaigns WHERE id=%s", [campaign_id])
    if not camp:
        return JsonResponse({'error':'not_found'}, status=404)
    if camp['owner_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    user_ids = data.get('user_ids') or []
    role_label_default = _limit_str(data.get('role_label','volunteer'), 50)
    if not isinstance(user_ids, list) or not user_ids:
        return JsonResponse({'error':'missing_user_ids'}, status=400)
    added = []
    reactivated = []
    for uid in user_ids:
        try:
            uid_i = int(uid)
        except Exception:
            continue
        existing = query("SELECT id,status FROM campaign_participants WHERE campaign_id=%s AND user_id=%s", [campaign_id, uid_i])
        if existing:
            if existing['status'] in ('withdrawn','rejected'):
                execute("UPDATE campaign_participants SET status='accepted', role_label=COALESCE(role_label,%s) WHERE id=%s", [role_label_default, existing['id']])
                reactivated.append(uid_i)
            continue
        try:
            pid = execute("INSERT INTO campaign_participants(campaign_id,user_id,role_label,status) VALUES(%s,%s,%s,'accepted')", [campaign_id, uid_i, role_label_default])
            added.append(pid)
        except Exception:
            continue
    return JsonResponse({'ok': True, 'added_count': len(added), 'reactivated_count': len(reactivated)})

# ============================= CAMPAIGN FINANCE (DONATIONS/EXPENSES) ==============================

def _ensure_campaign_finance_tables():
    # No-op: final schema includes campaign_donations and campaign_expenses.
    return None

@api_view(require_auth=True, methods=['POST'], csrf=False)
def campaign_add_donation(request: HttpRequest, campaign_id: int, _user=None):
    _ensure_campaign_finance_tables()
    camp = query("SELECT owner_user_id,status,title FROM campaigns WHERE id=%s", [campaign_id])
    if not camp:
        return JsonResponse({'error':'not_found'}, status=404)
    if camp['status'] == 'cancelled':
        return JsonResponse({'error':'not_accepting'}, status=400)
    data = json.loads(request.body or '{}')
    try:
        amount = float(data.get('amount') or 0)
    except Exception:
        return JsonResponse({'error':'invalid_amount'}, status=400)
    if amount <= 0:
        return JsonResponse({'error':'invalid_amount'}, status=400)
    currency = _limit_str((data.get('currency') or 'BDT').upper(), 8)
    note = data.get('note')
    did = execute("INSERT INTO campaign_donations(campaign_id,donor_user_id,amount,currency,note) VALUES(%s,%s,%s,%s,%s)", [campaign_id, _user['id'], amount, currency, note])
    # Notify campaign owner about donation
    try:
        from .utils import _ensure_notifications_table
        _ensure_notifications_table()
    except Exception:
        pass
    try:
        _notify(camp['owner_user_id'], 'campaign_donation', {
            'campaign_id': campaign_id,
            'campaign_title': camp.get('title'),
            'donor_user_id': _user['id'],
            'donor_name': _user.get('full_name') or _user.get('email'),
            'amount': amount,
            'currency': currency,
            'note': note,
            'donation_id': did,
        })
    except Exception:
        pass
    return JsonResponse({'id': did})

@api_view(methods=['GET'], csrf=False)
def campaign_list_donations(request: HttpRequest, campaign_id: int, _user=None):
    _ensure_campaign_finance_tables()
    rows = query("SELECT id,donor_user_id,amount,currency,note,created_at FROM campaign_donations WHERE campaign_id=%s ORDER BY id DESC LIMIT 200", [campaign_id], many=True) or []
    return JsonResponse({'results': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def campaign_add_expense(request: HttpRequest, campaign_id: int, _user=None):
    _ensure_campaign_finance_tables()
    camp = query("SELECT owner_user_id,status FROM campaigns WHERE id=%s", [campaign_id])
    if not camp:
        return JsonResponse({'error':'not_found'}, status=404)
    if camp['owner_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    try:
        amount = float(data.get('amount') or 0)
    except Exception:
        return JsonResponse({'error':'invalid_amount'}, status=400)
    if amount <= 0:
        return JsonResponse({'error':'invalid_amount'}, status=400)
    currency = _limit_str((data.get('currency') or 'BDT').upper(), 8)
    category = _limit_str(data.get('category','') or None, 64) if data.get('category') else None
    description = data.get('description')
    try:
        eid = execute("INSERT INTO campaign_expenses(campaign_id,amount,currency,category,description,created_by_user_id) VALUES(%s,%s,%s,%s,%s,%s)", [campaign_id, amount, currency, category, description, _user['id']])
    except Exception as e:
        return JsonResponse({'error':'insert_failed','detail': str(e)}, status=400)
    return JsonResponse({'id': eid})

@api_view(methods=['GET'], csrf=False)
def campaign_list_expenses(request: HttpRequest, campaign_id: int, _user=None):
    _ensure_campaign_finance_tables()
    # Public listing (owner will see same; amounts are public for transparency)
    rows = query("SELECT id,amount,currency,category,description,spent_at,created_by_user_id FROM campaign_expenses WHERE campaign_id=%s ORDER BY id DESC LIMIT 200", [campaign_id], many=True) or []
    return JsonResponse({'results': rows})

@api_view(methods=['GET'], csrf=False)
def campaign_finance_summary(request: HttpRequest, campaign_id: int, _user=None):
    _ensure_campaign_finance_tables()
    tot_d = query("SELECT COALESCE(SUM(amount),0) AS s, COALESCE(MAX(currency),'BDT') AS currency FROM campaign_donations WHERE campaign_id=%s", [campaign_id]) or {'s': 0, 'currency': 'BDT'}
    tot_e = query("SELECT COALESCE(SUM(amount),0) AS s, COALESCE(MAX(currency),'BDT') AS currency FROM campaign_expenses WHERE campaign_id=%s", [campaign_id]) or {'s': 0, 'currency': 'BDT'}
    total_donations = float(tot_d.get('s') or 0)
    total_expenses = float(tot_e.get('s') or 0)
    return JsonResponse({
        'campaign_id': campaign_id,
        'total_donations': total_donations,
        'total_expenses': total_expenses,
        'balance': round(total_donations - total_expenses, 2),
        'currency': tot_d.get('currency') or tot_e.get('currency') or 'BDT',
    })

# ============================= PHASE 4: FIRE SERVICE DISPATCH ==============================

FIRE_REQUEST_STATUSES = ('pending','assigned','resolved','cancelled')

def _is_fire_service(user):
    """Return True if the user represents a fire service/department.

    Accepts seeded role variants; normalizes case to avoid strict string mismatches.
    Examples considered valid: 'fire_service', 'fire_department', 'fd'.
    """
    role = str((user or {}).get('role') or '').lower()
    return role in ('fire_service', 'fire_department', 'fd')

@api_view(require_auth=True, methods=['POST'], csrf=False)
def create_fire_department(request: HttpRequest, _user=None):
    """Create a fire department record (fire_service or admin).

    Body: { name, lat?, lng? }
    For simplicity we treat the creating user as owning/representing the department.
    """
    if not (_is_fire_service(_user) or _require_admin(_user)):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    name = _limit_str(data.get('name','').strip(), 255)
    if not name:
        return JsonResponse({'error':'missing_name'}, status=400)
    lat = data.get('lat')
    lng = data.get('lng')
    try:
        dept_id = execute("INSERT INTO fire_departments(user_id,name,lat,lng) VALUES(%s,%s,%s,%s)", [_user['id'], name, lat, lng])
    except Exception as e:
        return JsonResponse({'error':'create_failed','detail':str(e)}, status=400)
    return JsonResponse({'id': dept_id})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def update_fire_department(request: HttpRequest, department_id: int, _user=None):
    """Update fire department (owner or admin). Body may include name, lat, lng."""
    dept = query("SELECT id,user_id FROM fire_departments WHERE id=%s", [department_id])
    if not dept:
        return JsonResponse({'error':'not_found'}, status=404)
    if not (_require_admin(_user) or dept['user_id'] == _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    sets=[]; params=[]
    if 'name' in data:
        name = _limit_str((data.get('name') or '').strip(), 255)
        if not name:
            return JsonResponse({'error':'missing_name'}, status=400)
        sets.append('name=%s'); params.append(name)
    if 'lat' in data:
        sets.append('lat=%s'); params.append(data.get('lat'))
    if 'lng' in data:
        sets.append('lng=%s'); params.append(data.get('lng'))
    if sets:
        params.append(department_id)
        execute('UPDATE fire_departments SET '+','.join(sets)+' WHERE id=%s', params)
    return JsonResponse({'ok': True})

@api_view(methods=['GET'], csrf=False)
def list_fire_departments(request: HttpRequest, _user=None):
    rows = query("SELECT id,user_id,name,lat,lng FROM fire_departments ORDER BY name ASC", [], many=True) or []
    return JsonResponse({'results': rows})

@api_view(methods=['GET','POST'], auth_methods=['POST'], csrf=False)
def fire_requests(request: HttpRequest, _user=None):
    """GET: list fire service requests (public)
    POST: create a new fire service request (auth required)
    Query params (GET): status
    Body (POST): { description, lat?, lng? }
    """
    if request.method == 'GET':
        from .utils import paginate
        status_f = request.GET.get('status')
        show_all = request.GET.get('all') in ('1','true','yes')
        where = []; params=[]
        if status_f:
            where.append('fsr.status=%s'); params.append(status_f)
        base = ('SELECT fsr.id,fsr.requester_id,fsr.lat,fsr.lng,fsr.description,fsr.status,'
            'fsr.assigned_department_id,fsr.assigned_team_id,fsr.assigned_team_at,fsr.created_at,'
            't.name AS assigned_team_name,t.status AS assigned_team_status, d.name AS assigned_department_name, d.user_id AS assigned_department_owner_user_id '
                    'FROM fire_service_requests fsr '
                    'LEFT JOIN fire_teams t ON t.id=fsr.assigned_team_id '
                    'LEFT JOIN fire_departments d ON d.id=fsr.assigned_department_id')
        # Filter to only my requests if mine=1
        if request.GET.get('mine') in ('1','true','yes') and _user:
            where.append('fsr.requester_id=%s'); params.append(_user['id'])
            # Exclude requests hidden by this user (per-user hide)
            where.append('NOT EXISTS (SELECT 1 FROM fire_request_user_hides h WHERE h.request_id=fsr.id AND h.user_id=%s)'); params.append(_user['id'])
        # Fire service scoping (only when not requesting all & not using mine filter)
        if _user and _is_fire_service(_user) and not show_all and request.GET.get('mine') not in ('1','true','yes'):
            dept = query('SELECT id,lat,lng FROM fire_departments WHERE user_id=%s LIMIT 1', [_user['id']])
            if dept:
                dept_id = dept['id']
                # Show any requests explicitly tied to this department (assigned or candidate), regardless of distance.
                # Additionally, include geographically close requests even if not yet tied (fallback browse nearby).
                if dept.get('lat') is not None and dept.get('lng') is not None:
                    where.append('((fsr.assigned_department_id=%s OR EXISTS (SELECT 1 FROM fire_request_candidates c WHERE c.request_id=fsr.id AND c.department_id=%s)) OR (fsr.lat IS NULL OR (ABS(fsr.lat-%s) < 1.0 AND ABS(fsr.lng-%s) < 1.0)))')
                    params.extend([dept_id, dept_id, dept['lat'], dept['lng']])
                else:
                    # No coordinates set for department: rely solely on assignment/candidate relationship
                    where.append('(fsr.assigned_department_id=%s OR EXISTS (SELECT 1 FROM fire_request_candidates c WHERE c.request_id=fsr.id AND c.department_id=%s))')
                    params.extend([dept_id, dept_id])
        if where:
            base += ' WHERE ' + ' AND '.join(where)
        rows, meta = paginate(request, base, params, order_fragment=' ORDER BY fsr.created_at DESC')
        # If mine=1 augment each with candidate departments (names + status)
        if request.GET.get('mine') in ('1','true','yes') and _user and rows:
            ids = [r['id'] for r in rows]
            try:
                placeholders = ','.join(['%s']*len(ids))
                cand_rows = query(
                    'SELECT c.request_id,c.department_id,c.status,fd.name,fd.user_id AS owner_user_id FROM fire_request_candidates c JOIN fire_departments fd ON fd.id=c.department_id WHERE c.request_id IN ('+placeholders+')',
                    ids,
                    many=True
                ) or []
                by_req = {}
                for c in cand_rows:
                    by_req.setdefault(c['request_id'], []).append({
                        'department_id': c['department_id'],
                        'name': c['name'],
                        'status': c['status'],
                        'owner_user_id': c.get('owner_user_id'),
                    })
                for r in rows:
                    r['candidate_departments'] = by_req.get(r['id'], [])
            except Exception:
                for r in rows:
                    r['candidate_departments'] = []
            # Lazy fallback: if a pending request has no candidates yet but has coordinates,
            # attempt on-demand nearest department selection (idempotent best-effort).
            try:
                import math
                needing = [r for r in rows if r.get('status') == 'pending' and not r.get('candidate_departments') and r.get('lat') is not None and r.get('lng') is not None]
                if needing:
                    # Preload geocoded departments once
                    depts = query("SELECT id,lat,lng FROM fire_departments WHERE lat IS NOT NULL AND lng IS NOT NULL LIMIT 500", many=True) or []
                    def hav(a_lat, a_lng, b_lat, b_lng):
                        R = 6371.0
                        dlat = math.radians(b_lat - a_lat); dlng = math.radians(b_lng - a_lng)
                        alat = math.radians(a_lat); blat = math.radians(b_lat)
                        h = math.sin(dlat/2)**2 + math.cos(alat)*math.cos(blat)*math.sin(dlng/2)**2
                        return 2 * R * math.asin(math.sqrt(h))
                    for r in needing:
                        try:
                            nearest=None; nearest_d=9999.0
                            for dpt in depts:
                                try:
                                    dist = hav(float(r['lat']), float(r['lng']), float(dpt['lat']), float(dpt['lng']))
                                except Exception:
                                    continue
                                if dist < nearest_d and dist <= 50.0: # 50 km radius
                                    nearest_d = dist; nearest = dpt['id']
                            # Fallback: if none within radius, pick absolute nearest overall
                            if nearest is None and depts:
                                try:
                                    any_nearest = min(
                                        (
                                            (hav(float(r['lat']), float(r['lng']), float(dpt['lat']), float(dpt['lng'])), dpt['id'])
                                            for dpt in depts
                                        ),
                                        key=lambda x: x[0]
                                    )
                                    nearest = any_nearest[1]
                                except Exception:
                                    nearest = None
                            if nearest is not None:
                                # Insert candidate if not exists
                                try:
                                    existing = query('SELECT id FROM fire_request_candidates WHERE request_id=%s AND department_id=%s', [r['id'], nearest])
                                    if not existing:
                                        execute('INSERT INTO fire_request_candidates(request_id, department_id, candidate_rank) VALUES(%s,%s,%s)', [r['id'], nearest, 1])
                                        dept_name = query('SELECT name FROM fire_departments WHERE id=%s', [nearest])
                                        r['candidate_departments'] = [{ 'department_id': nearest, 'name': (dept_name and dept_name.get('name')) or None, 'status': 'pending' }]
                                except Exception:
                                    pass
                        except Exception:
                            continue
            except Exception:
                pass
        return JsonResponse({'results': rows, **meta, 'filtered': (_user and _is_fire_service(_user) and not show_all and request.GET.get('mine') not in ('1','true','yes'))})
    # POST path
    data = json.loads(request.body or '{}')
    description = _limit_str(data.get('description','').strip(), 2000)
    if not description:
        return JsonResponse({'error':'missing_description'}, status=400)
    lat = data.get('lat'); lng = data.get('lng')
    # Fallback: if coordinates not provided, use user's last-known location
    try:
        if (lat is None or lng is None):
            loc = query(
                """
                SELECT ul.lat, ul.lng
                FROM user_locations ul
                JOIN (
                    SELECT user_id, MAX(captured_at) AS max_cap
                    FROM user_locations
                    GROUP BY user_id
                ) latest ON latest.user_id = ul.user_id AND latest.max_cap = ul.captured_at
                WHERE ul.user_id=%s
                LIMIT 1
                """,
                [_user['id']]
            )
            if loc:
                if lat is None:
                    lat = loc.get('lat')
                if lng is None:
                    lng = loc.get('lng')
    except Exception:
        pass
    rid = execute("INSERT INTO fire_service_requests(requester_id,lat,lng,description) VALUES(%s,%s,%s,%s)", [_user['id'], lat, lng, description])

    # Candidate generation (single nearest) without auto-assigning
    candidate_id = None
    try:
        # If the caller targets a specific department, prioritize that and skip nearest generation
        target_dept_id = data.get('target_department_id')
        if target_dept_id:
            try:
                exists = query('SELECT id FROM fire_departments WHERE id=%s', [target_dept_id])
                if exists:
                    existing = query('SELECT id FROM fire_request_candidates WHERE request_id=%s AND department_id=%s', [rid, target_dept_id])
                    if not existing:
                        candidate_id = execute("INSERT INTO fire_request_candidates(request_id, department_id, candidate_rank) VALUES(%s,%s,%s)", [rid, int(target_dept_id), 1])
                    # notify owner + staff
                    try:
                        dept_user = query("SELECT user_id FROM fire_departments WHERE id=%s", [target_dept_id])
                        if dept_user:
                            _notify(dept_user['user_id'], 'fire_request_candidate', {'request_id': rid})
                        try:
                            staff_rows = query("SELECT user_id FROM fire_staff WHERE department_id=%s", [target_dept_id], many=True) or []
                            for sr in staff_rows:
                                try:
                                    if sr.get('user_id') and int(sr['user_id']) != int(dept_user.get('user_id') or 0):
                                        _notify(int(sr['user_id']), 'fire_request_candidate', {'request_id': rid})
                                except Exception:
                                    continue
                        except Exception:
                            pass
                    except Exception:
                        pass
                    # Skip nearest generation if explicit target provided
                    raise StopIteration
            except StopIteration:
                pass
        if lat is not None and lng is not None:
            import math
            RADIUS_KM = 50.0
            box_delta = 0.5
            min_lat = float(lat) - box_delta; max_lat = float(lat) + box_delta
            lng_delta = box_delta / max(math.cos(math.radians(float(lat))), 0.0001)
            min_lng = float(lng) - lng_delta; max_lng = float(lng) + lng_delta
            departments = query(
                "SELECT id,lat,lng FROM fire_departments WHERE lat IS NOT NULL AND lng IS NOT NULL AND lat BETWEEN %s AND %s AND lng BETWEEN %s AND %s LIMIT 300",
                [min_lat, max_lat, min_lng, max_lng], many=True
            ) or []
            def hav(a_lat, a_lng, b_lat, b_lng):
                R = 6371.0
                dlat = math.radians(b_lat - a_lat)
                dlng = math.radians(b_lng - a_lng)
                alat = math.radians(a_lat); blat = math.radians(b_lat)
                h = math.sin(dlat/2)**2 + math.cos(alat)*math.cos(blat)*math.sin(dlng/2)**2
                return 2 * R * math.asin(math.sqrt(h))
            nearest=None; nearest_d=9999
            for dpt in departments:
                try:
                    dist = hav(float(lat), float(lng), float(dpt['lat']), float(dpt['lng']))
                except Exception:
                    continue
                if dist < nearest_d and dist <= RADIUS_KM:
                    nearest_d = dist; nearest = dpt['id']
            # If no department found within radius, pick absolute nearest overall (global fallback)
            if nearest is None and departments:
                try:
                    any_nearest = min(
                        (
                            (hav(float(lat), float(lng), float(dpt['lat']), float(dpt['lng'])), dpt['id'])
                            for dpt in departments
                        ),
                        key=lambda x: x[0]
                    )
                    nearest = any_nearest[1]
                except Exception:
                    nearest = None
            if nearest is not None:
                candidate_id = execute("INSERT INTO fire_request_candidates(request_id, department_id, candidate_rank) VALUES(%s,%s,%s)", [rid, nearest, 1])
                try:
                    dept_user = query("SELECT user_id FROM fire_departments WHERE id=%s", [nearest])
                    if dept_user:
                        _notify(dept_user['user_id'], 'fire_request_candidate', {'request_id': rid})
                    # notify staff as well
                    try:
                        staff_rows = query("SELECT user_id FROM fire_staff WHERE department_id=%s", [nearest], many=True) or []
                        for sr in staff_rows:
                            try:
                                if sr.get('user_id') and int(sr['user_id']) != int(dept_user.get('user_id') or 0):
                                    _notify(int(sr['user_id']), 'fire_request_candidate', {'request_id': rid})
                            except Exception:
                                continue
                    except Exception:
                        pass
                except Exception:
                    pass
    except Exception:
        pass
    try:
        payload = {'request_id': rid, 'candidate_generated': bool(candidate_id)}
        _notify(_user['id'], 'fire_request_created', payload)
    except Exception:
        pass
    return JsonResponse({'id': rid, 'candidate_id': candidate_id})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def deploy_fire_request_team(request: HttpRequest, request_id: int, _user=None):
    """Assign (deploy) a specific fire team owned by the fire service user to a request.

    Body: { team_id }
    Rules:
      - User must be fire_service and own the department the team belongs to.
      - If request not yet assigned to any department, it will be assigned to this team/department and status->assigned.
      - If already assigned_department_id differs from the team's department -> forbidden.
      - Sets assigned_team_id.
    """
    if not _is_fire_service(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    fr = query('SELECT id,assigned_department_id,status FROM fire_service_requests WHERE id=%s', [request_id])
    if not fr:
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    team_id = data.get('team_id')
    if not team_id:
        return JsonResponse({'error':'missing_team_id'}, status=400)
    # Identify user's department
    dept = query('SELECT id FROM fire_departments WHERE user_id=%s LIMIT 1', [_user['id']])
    if not dept:
        return JsonResponse({'error':'no_department'}, status=400)
    team = query('SELECT id,department_id FROM fire_teams WHERE id=%s AND department_id=%s', [team_id, dept['id']])
    if not team:
        return JsonResponse({'error':'team_not_found'}, status=404)
    # assigned_team_id exists per final schema.
    # Check assignment compatibility
    if fr['assigned_department_id'] and fr['assigned_department_id'] != dept['id']:
        return JsonResponse({'error':'already_assigned_elsewhere'}, status=409)
    # Perform assignment
    # assigned_team_at exists per final schema.
    if not fr['assigned_department_id']:
        execute("UPDATE fire_service_requests SET assigned_department_id=%s, assigned_team_id=%s, status='assigned', assigned_team_at=NOW() WHERE id=%s", [dept['id'], team_id, request_id])
    else:
        # Preserve existing status; if not yet assigned mark assigned
        if fr['status'] != 'assigned':
            execute("UPDATE fire_service_requests SET assigned_team_id=%s, assigned_team_at=NOW(), status='assigned' WHERE id=%s", [team_id, request_id])
        else:
            execute('UPDATE fire_service_requests SET assigned_team_id=%s, assigned_team_at=NOW() WHERE id=%s', [team_id, request_id])
    # Notify all team members they were deployed (best-effort)
    try:
        members = query(
            """
            SELECT s.user_id FROM fire_team_members m
            JOIN fire_staff s ON s.id = m.staff_id
            WHERE m.team_id=%s
            """,
            [team_id], many=True
        ) or []
        for m in members:
            try:
                if m.get('user_id'):
                    _notify(int(m['user_id']), 'fire_team_deployed', {'request_id': request_id, 'team_id': team_id})
            except Exception:
                continue
    except Exception:
        pass
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def assign_fire_request(request: HttpRequest, request_id: int, _user=None):
    """Assign a fire service request to a department (fire_service or admin).

    Body: { department_id }
    """
    if not (_is_fire_service(_user) or _require_admin(_user)):
        return JsonResponse({'error':'forbidden'}, status=403)
    fr = query("SELECT * FROM fire_service_requests WHERE id=%s", [request_id])
    if not fr:
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    dept_id = data.get('department_id')
    if not dept_id:
        return JsonResponse({'error':'missing_department'}, status=400)
    dept = query("SELECT id FROM fire_departments WHERE id=%s", [dept_id])
    if not dept:
        return JsonResponse({'error':'department_not_found'}, status=404)
    # Update assignment
    execute("UPDATE fire_service_requests SET assigned_department_id=%s, status='assigned' WHERE id=%s", [dept_id, request_id])
    try:
        _notify(fr['requester_id'], 'fire_request_assigned', {'request_id': request_id, 'department_id': dept_id})
    except Exception:
        pass
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def complete_fire_request(request: HttpRequest, request_id: int, _user=None):
    """Mark an active deployed fire request as completed by the owning fire service department.

    Sets status='completed' and a completion timestamp.
    """
    if not _is_fire_service(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    fr = query('SELECT id, assigned_department_id, status FROM fire_service_requests WHERE id=%s', [request_id])
    if not fr:
        return JsonResponse({'error':'not_found'}, status=404)
    dept = query('SELECT id FROM fire_departments WHERE user_id=%s LIMIT 1', [_user['id']])
    if not dept:
        return JsonResponse({'error':'no_department'}, status=400)
    if fr['assigned_department_id'] != dept['id']:
        return JsonResponse({'error':'not_owner'}, status=403)
    if fr['status'] == 'completed':
        return JsonResponse({'ok': True, 'already': True})
    # completed_at and 'completed' status are present per final schema.
    # Try setting completed; if DataError occurs again we fallback to resolved
    try:
        execute("UPDATE fire_service_requests SET status='completed', completed_at=NOW() WHERE id=%s", [request_id])
    except Exception:
        # Fallback to existing enum value 'resolved' if 'completed' still invalid
        try:
            execute("UPDATE fire_service_requests SET status='resolved', completed_at=NOW() WHERE id=%s", [request_id])
        except Exception:
            return JsonResponse({'error':'status_update_failed'}, status=500)
    try:
        _notify(_user['id'], 'fire_request_completed', {'request_id': request_id})
    except Exception:
        pass
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def cancel_fire_request(request: HttpRequest, request_id: int, _user=None):
    """Allow the original requester to cancel their pending (or unassigned) fire request.

    Rules:
      - Only requester (requester_id matches current user) OR admin can cancel.
      - Only allowed when status in ('pending') and not yet assigned to a department/team.
      - Sets status='cancelled'.
    Response: { ok: true } or appropriate error.
    """
    fr = query('SELECT id, requester_id, status, assigned_department_id, assigned_team_id FROM fire_service_requests WHERE id=%s', [request_id])
    if not fr:
        return JsonResponse({'error':'not_found'}, status=404)
    if not (_require_admin(_user) or (_user and fr['requester_id'] == _user['id'])):
        return JsonResponse({'error':'forbidden'}, status=403)
    if fr['status'] == 'cancelled':
        return JsonResponse({'ok': True, 'already': True})
    # Disallow cancellation after assignment (department/team engaged)
    if fr.get('assigned_department_id') or fr.get('assigned_team_id') or fr['status'] not in ('pending',):
        return JsonResponse({'error':'cannot_cancel_now'}, status=409)
    try:
        execute("UPDATE fire_service_requests SET status='cancelled' WHERE id=%s", [request_id])
    except Exception:
        return JsonResponse({'error':'update_failed'}, status=500)
    try:
        _notify(fr['requester_id'], 'fire_request_cancelled', {'request_id': request_id})
    except Exception:
        pass
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def hide_fire_request(request: HttpRequest, request_id: int, _user=None):
    """Soft-hide a fire service request from the current requester's view only.

    - Only the original requester or an admin can hide.
    - Does not modify the request record; responders still see it in their logs.
    - Idempotent: multiple calls result in a single hide row.
    """
    fr = query('SELECT id, requester_id FROM fire_service_requests WHERE id=%s', [request_id])
    if not fr:
        return JsonResponse({'error': 'not_found'}, status=404)
    if not (_require_admin(_user) or (_user and fr['requester_id'] == _user['id'])):
        return JsonResponse({'error': 'forbidden'}, status=403)
    # fire_request_user_hides exists per final schema.
    # Insert ignore to be idempotent
    try:
        execute('INSERT IGNORE INTO fire_request_user_hides(user_id, request_id) VALUES(%s,%s)', [_user['id'], request_id])
    except Exception:
        # Fallback for environments lacking INSERT IGNORE
        try:
            existing = query('SELECT id FROM fire_request_user_hides WHERE user_id=%s AND request_id=%s', [_user['id'], request_id])
            if not existing:
                execute('INSERT INTO fire_request_user_hides(user_id, request_id) VALUES(%s,%s)', [_user['id'], request_id])
        except Exception:
            return JsonResponse({'error': 'hide_failed'}, status=500)
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def fire_activities(request: HttpRequest, _user=None):
    """List deployments for the user's fire department.

    Access:
      - fire_service owners: department derived from their owned department
      - fire staff: department derived from fire_staff(user_id)
      - admin: optionally ?department_id=...

    Response:
      - results: flat list of requests assigned to the department with team/department info
      - items: same as results (compat)
      - current/past groups preserved for backward compatibility
    """
    dept_id = None
    # Admin override
    if _require_admin(_user):
        try:
            dept_id = int(request.GET.get('department_id') or 0) or None
        except Exception:
            dept_id = None
    # Owner path
    if dept_id is None and _is_fire_service(_user):
        dept = query('SELECT id FROM fire_departments WHERE user_id=%s LIMIT 1', [_user['id']])
        dept_id = dept and dept.get('id')
    # Staff path
    if dept_id is None:
        staff = query('SELECT department_id FROM fire_staff WHERE user_id=%s LIMIT 1', [_user['id']])
        dept_id = staff and staff.get('department_id')
    if not dept_id:
        return JsonResponse({'results': [], 'items': [], 'current': [], 'past': []})
    # Columns exist per final schema.
    base = (
        "SELECT fsr.id, fsr.description, fsr.status, fsr.assigned_team_id, fsr.assigned_team_at, fsr.completed_at, fsr.created_at, "
        " t.name AS team_name, t.status AS team_status, fd.name AS assigned_department_name, fsr.description AS location_text "
        "FROM fire_service_requests fsr "
        "LEFT JOIN fire_teams t ON t.id=fsr.assigned_team_id "
        "LEFT JOIN fire_departments fd ON fd.id=fsr.assigned_department_id "
        "WHERE fsr.assigned_department_id=%s ORDER BY fsr.id DESC"
    )
    rows = query(base, [dept_id], many=True) or []
    current = [r for r in rows if str(r.get('status') or '').lower() not in ('completed','withdrawn')]
    past = [r for r in rows if str(r.get('status') or '').lower() in ('completed','withdrawn')]
    return JsonResponse({'results': rows, 'items': rows, 'current': current, 'past': past, 'department_id': dept_id})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def change_fire_request_status(request: HttpRequest, request_id: int, _user=None):
    """Change status of a fire service request.

    Allowed transitions (loose on purpose for shallow pass):
        pending -> assigned|cancelled
        assigned -> resolved|cancelled
    """
    fr = query("SELECT * FROM fire_service_requests WHERE id=%s", [request_id])
    if not fr:
        return JsonResponse({'error':'not_found'}, status=404)
    # Only fire_service/admin or original requester (for cancellation) can modify
    data = json.loads(request.body or '{}')
    new_status = data.get('status')
    if new_status not in FIRE_REQUEST_STATUSES:
        return JsonResponse({'error':'invalid_status'}, status=400)
    if not (_is_fire_service(_user) or _require_admin(_user) or (new_status=='cancelled' and fr['requester_id']==_user['id'])):
        return JsonResponse({'error':'forbidden'}, status=403)
    # Basic transition sanity
    if fr['status']=='resolved' or fr['status']=='cancelled':
        return JsonResponse({'error':'immutable'}, status=400)
    if fr['status']=='pending' and new_status not in ('assigned','cancelled'):
        return JsonResponse({'error':'invalid_transition'}, status=400)
    if fr['status']=='assigned' and new_status not in ('resolved','cancelled'):
        return JsonResponse({'error':'invalid_transition'}, status=400)
    execute("UPDATE fire_service_requests SET status=%s WHERE id=%s", [new_status, request_id])
    try:
        _notify(fr['requester_id'], 'fire_request_status', {'request_id': request_id, 'status': new_status})
    except Exception:
        pass
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def assign_fire_request_nearest(request: HttpRequest, request_id: int, _user=None):
    """Retroactively assign the nearest fire department to an unassigned request.

    Body: { force?: bool }
    Rules:
      - Only fire_service or admin may invoke.
      - Skips if already assigned unless force=true.
      - Uses same 50km radius + bounding box heuristic as creation auto-assignment.
    """
    if not (_is_fire_service(_user) or _require_admin(_user)):
        return JsonResponse({'error':'forbidden'}, status=403)
    fr = query("SELECT * FROM fire_service_requests WHERE id=%s", [request_id])
    if not fr:
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    force = bool(data.get('force'))
    if fr.get('assigned_department_id') and not force:
        return JsonResponse({'error':'already_assigned'}, status=400)
    # If a pending candidate already exists and not forcing, no need to regenerate
    existing = query("SELECT id,status FROM fire_request_candidates WHERE request_id=%s AND status='pending'", [request_id])
    if existing and not force:
        return JsonResponse({'candidate_id': existing['id'], 'status':'pending'})
    # Determine coordinates to use
    lat = fr.get('lat'); lng = fr.get('lng')
    if lat is None or lng is None:
        # Prefer latest location from user_locations to avoid optional users.last_lat/last_lng dependency
        req_loc = None
        try:
            req_loc = query(
                "SELECT lat, lng FROM user_locations WHERE user_id=%s ORDER BY captured_at DESC LIMIT 1",
                [fr['requester_id']]
            )
        except Exception:
            req_loc = None
        if req_loc:
            lat = req_loc.get('lat'); lng = req_loc.get('lng')
        # As a last resort, if columns exist on users, use them
        if (lat is None or lng is None):
            try:
                col = query(
                    """
                    SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='last_lat'
                    """
                )
                if col:
                    req_user = query("SELECT last_lat,last_lng FROM users WHERE id=%s", [fr['requester_id']])
                    if req_user:
                        lat = req_user.get('last_lat'); lng = req_user.get('last_lng')
            except Exception:
                pass
    if lat is None or lng is None:
        return JsonResponse({'error':'no_coordinates'}, status=400)
    # Candidate search
    import math
    RADIUS_KM = 50.0
    box_delta = 0.5
    min_lat = float(lat) - box_delta; max_lat = float(lat) + box_delta
    lng_delta = box_delta / max(math.cos(math.radians(float(lat))), 0.0001)
    min_lng = float(lng) - lng_delta; max_lng = float(lng) + lng_delta
    # Exclude departments already tried for this request
    tried_ids = set(r['department_id'] for r in (query("SELECT department_id FROM fire_request_candidates WHERE request_id=%s", [request_id], many=True) or []))
    candidates = query(
        "SELECT id, lat, lng FROM fire_departments WHERE lat IS NOT NULL AND lng IS NOT NULL AND lat BETWEEN %s AND %s AND lng BETWEEN %s AND %s LIMIT 500",
        [min_lat, max_lat, min_lng, max_lng], many=True
    ) or []
    def hav(a_lat, a_lng, b_lat, b_lng):
        R = 6371.0
        dlat = math.radians(b_lat - a_lat)
        dlng = math.radians(b_lng - a_lng)
        alat = math.radians(a_lat); blat = math.radians(b_lat)
        h = math.sin(dlat/2)**2 + math.cos(alat)*math.cos(blat)*math.sin(dlng/2)**2
        return 2 * R * math.asin(math.sqrt(h))
    nearest = None; nearest_d = 9999
    for c in candidates:
        if c['id'] in tried_ids:
            continue
        try:
            d = hav(float(lat), float(lng), float(c['lat']), float(c['lng']))
        except Exception:
            continue
        if d < nearest_d and d <= RADIUS_KM:
            nearest_d = d; nearest = c['id']
    # Fallback to absolute nearest globally (excluding tried) if none in radius
    if nearest is None and candidates:
        try:
            any_nearest = min(
                (
                    (hav(float(lat), float(lng), float(c['lat']), float(c['lng'])), c['id'])
                    for c in candidates if c['id'] not in tried_ids
                ),
                key=lambda x: x[0]
            )
            nearest = any_nearest[1]
            nearest_d = any_nearest[0]
        except Exception:
            nearest = None
    if nearest is None:
        return JsonResponse({'error':'no_department_in_radius'}, status=404)
    # Insert candidate (rank = count(existing)+1)
    rank = (query("SELECT COUNT(1) AS c FROM fire_request_candidates WHERE request_id=%s", [request_id]) or {}).get('c',0) + 1
    cid = execute("INSERT INTO fire_request_candidates(request_id, department_id, candidate_rank) VALUES(%s,%s,%s)", [request_id, nearest, rank])
    try:
        dept_user = query("SELECT user_id FROM fire_departments WHERE id=%s", [nearest])
        if dept_user:
            _notify(dept_user['user_id'], 'fire_request_candidate', {'request_id': request_id})
    except Exception:
        pass
    return JsonResponse({'candidate_id': cid, 'rank': rank, 'distance_km': round(nearest_d,2)})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def fire_request_candidate_accept(request: HttpRequest, request_id: int, _user=None):
    if not (_is_fire_service(_user) or _require_admin(_user)):
        return JsonResponse({'error':'forbidden'}, status=403)
    # Find pending candidate for this department's fire_department (if user is fire_service) or any if admin
    dept = query("SELECT id FROM fire_departments WHERE user_id=%s", [_user['id']]) if _is_fire_service(_user) else None
    if _is_fire_service(_user) and not dept:
        return JsonResponse({'error':'no_department_context'}, status=400)
    base_q = "SELECT c.* FROM fire_request_candidates c JOIN fire_service_requests r ON r.id=c.request_id WHERE c.request_id=%s AND c.status='pending'"
    params = [request_id]
    if dept:
        base_q += " AND c.department_id=%s"; params.append(dept['id'])
    cand = query(base_q, params)
    if not cand:
        return JsonResponse({'error':'no_pending_candidate'}, status=404)
    # Accept: mark candidate and update request
    execute("UPDATE fire_request_candidates SET status='accepted' WHERE id=%s", [cand['id']])
    execute("UPDATE fire_service_requests SET assigned_department_id=%s, status='assigned' WHERE id=%s", [cand['department_id'], request_id])
    fr = query("SELECT requester_id FROM fire_service_requests WHERE id=%s", [request_id])
    try:
        _notify(fr['requester_id'], 'fire_request_assigned', {'request_id': request_id, 'department_id': cand['department_id']})
    except Exception:
        pass
    return JsonResponse({'ok': True, 'assigned_department_id': cand['department_id']})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def fire_request_candidate_decline(request: HttpRequest, request_id: int, _user=None):
    if not (_is_fire_service(_user) or _require_admin(_user)):
        return JsonResponse({'error':'forbidden'}, status=403)
    dept = query("SELECT id FROM fire_departments WHERE user_id=%s", [_user['id']]) if _is_fire_service(_user) else None
    if _is_fire_service(_user) and not dept:
        return JsonResponse({'error':'no_department_context'}, status=400)
    base_q = "SELECT c.* FROM fire_request_candidates c WHERE c.request_id=%s AND c.status='pending'"
    params=[request_id]
    if dept:
        base_q += " AND c.department_id=%s"; params.append(dept['id'])
    cand = query(base_q, params)
    if not cand:
        return JsonResponse({'error':'no_pending_candidate'}, status=404)
    execute("UPDATE fire_request_candidates SET status='declined' WHERE id=%s", [cand['id']])
    return JsonResponse({'ok': True})

# ---------------------------------------------------------------------------
# Breadth-first Messaging (Feature 42 stub)
# ---------------------------------------------------------------------------

def _is_participant(conversation_id: int, user_id: int):
    row = query("SELECT id FROM conversation_participants WHERE conversation_id=%s AND user_id=%s", [conversation_id, user_id])
    return bool(row)

@api_view(require_auth=True, methods=['POST'], csrf=False)
def create_conversation(request: HttpRequest, _user=None):
    data = json.loads(request.body or '{}')
    other_user_id = data.get('other_user_id')
    if not other_user_id or int(other_user_id) == _user['id']:
        return JsonResponse({'error':'invalid_other_user'}, status=400)
    # Re-use existing 1:1 conversation if exists
    existing = query(
        """
        SELECT c.id FROM conversations c
        JOIN conversation_participants p1 ON p1.conversation_id=c.id AND p1.user_id=%s
        JOIN conversation_participants p2 ON p2.conversation_id=c.id AND p2.user_id=%s
        WHERE c.is_group=0
        LIMIT 1
        """, [_user['id'], other_user_id]
    )
    if existing:
        return JsonResponse({'id': existing['id'], 'reused': True})
    cid = execute("INSERT INTO conversations(is_group, created_by_user_id) VALUES(0,%s)", [_user['id']])
    execute("INSERT INTO conversation_participants(conversation_id,user_id) VALUES(%s,%s)", [cid, _user['id']])
    execute("INSERT INTO conversation_participants(conversation_id,user_id) VALUES(%s,%s)", [cid, other_user_id])
    return JsonResponse({'id': cid, 'reused': False})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_conversations(request: HttpRequest, _user=None):
        rows = query(
                """
                SELECT c.id, c.is_group, c.created_at,
                             (SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
                             (SELECT created_at FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message_time,
                             (
                                 SELECT u.full_name FROM conversation_participants cp2
                                 JOIN users u ON u.id=cp2.user_id
                                 WHERE cp2.conversation_id=c.id AND cp2.user_id <> %s
                                 LIMIT 1
                             ) AS partner_name,
                             (
                                 SELECT cp2.user_id FROM conversation_participants cp2
                                 WHERE cp2.conversation_id=c.id AND cp2.user_id <> %s
                                 LIMIT 1
                             ) AS partner_user_id
                FROM conversations c
                JOIN conversation_participants p ON p.conversation_id=c.id AND p.user_id=%s
                ORDER BY COALESCE(last_message_time, c.created_at) DESC
                LIMIT 100
                """, [_user['id'], _user['id'], _user['id']], many=True
        ) or []
        return JsonResponse({'items': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def send_message(request: HttpRequest, conversation_id: int, _user=None):
    if not _is_participant(conversation_id, _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    body = (data.get('body') or '').strip()
    if not body:
        return JsonResponse({'error':'empty_body'}, status=400)
    mid = execute("INSERT INTO messages(conversation_id,sender_user_id,body) VALUES(%s,%s,%s)", [conversation_id, _user['id'], body])
    # Notify other participants
    try:
        others = query("SELECT user_id FROM conversation_participants WHERE conversation_id=%s AND user_id<>%s", [conversation_id, _user['id']], many=True) or []
        for o in others:
            _notify(o['user_id'], 'message_new', {'conversation_id': conversation_id, 'message_id': mid})
    except Exception:
        pass
    return JsonResponse({'id': mid})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_messages(request: HttpRequest, conversation_id: int, _user=None):
    if not _is_participant(conversation_id, _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    rows = query("SELECT id,sender_user_id,body,created_at FROM messages WHERE conversation_id=%s ORDER BY id DESC LIMIT 100", [conversation_id], many=True) or []
    return JsonResponse({'items': rows})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def inbox(request: HttpRequest, _user=None):
    # Include unread counts leveraging last_read_message_id (NULL => all messages unread until first read)
    rows = query(
        """
        SELECT c.id,
               c.is_group,
               c.created_at,
               (SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
               (SELECT created_at FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message_time,
               (SELECT u.full_name FROM conversation_participants cp2 JOIN users u ON u.id=cp2.user_id WHERE cp2.conversation_id=c.id AND cp2.user_id <> %s LIMIT 1) AS partner_name,
               (SELECT cp2.user_id FROM conversation_participants cp2 WHERE cp2.conversation_id=c.id AND cp2.user_id <> %s LIMIT 1) AS partner_user_id,
               COALESCE((SELECT COUNT(1) FROM messages m3 WHERE m3.conversation_id=c.id AND (p.last_read_message_id IS NULL OR m3.id > p.last_read_message_id)),0) AS unread_count
        FROM conversations c
        JOIN conversation_participants p ON p.conversation_id=c.id AND p.user_id=%s
        ORDER BY COALESCE(last_message_time, c.created_at) DESC
        LIMIT 100
        """, [_user['id'], _user['id'], _user['id']], many=True
    ) or []
    total_unread = sum(int(r.get('unread_count') or 0) for r in rows)
    return JsonResponse({'items': rows, 'total_unread': total_unread})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def send_direct_message(request: HttpRequest, _user=None):
    data = json.loads(request.body or '{}')
    target_user_id = data.get('target_user_id')
    body = (data.get('body') or '').strip()
    if not target_user_id or int(target_user_id) == _user['id']:
        return JsonResponse({'error':'invalid_target'}, status=400)
    if not body:
        return JsonResponse({'error':'empty_body'}, status=400)
    # Find or create 1:1 conversation
    existing = query(
        """
        SELECT c.id FROM conversations c
        JOIN conversation_participants p1 ON p1.conversation_id=c.id AND p1.user_id=%s
        JOIN conversation_participants p2 ON p2.conversation_id=c.id AND p2.user_id=%s
        WHERE c.is_group=0
        LIMIT 1
        """, [_user['id'], target_user_id]
    )
    if existing:
        cid = existing['id']
    else:
        cid = execute("INSERT INTO conversations(is_group, created_by_user_id) VALUES(0,%s)", [_user['id']])
        execute("INSERT INTO conversation_participants(conversation_id,user_id) VALUES(%s,%s)", [cid, _user['id']])
        execute("INSERT INTO conversation_participants(conversation_id,user_id) VALUES(%s,%s)", [cid, target_user_id])
    mid = execute("INSERT INTO messages(conversation_id,sender_user_id,body) VALUES(%s,%s,%s)", [cid, _user['id'], body])
    # Notify target
    try:
        _notify(int(target_user_id), 'message_new', {'conversation_id': cid, 'message_id': mid})
    except Exception:
        pass
    return JsonResponse({'conversation_id': cid, 'message_id': mid})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def conversation_history(request: HttpRequest, conversation_id: int, _user=None):
    if not _is_participant(conversation_id, _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    rows = query("SELECT id,sender_user_id,body,created_at FROM messages WHERE conversation_id=%s ORDER BY id ASC", [conversation_id], many=True) or []
    return JsonResponse({'items': rows})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def messages_since(request: HttpRequest, conversation_id: int, _user=None):
    if not _is_participant(conversation_id, _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    after_id = request.GET.get('after_id')
    params = [conversation_id]
    clause = ''
    if after_id and str(after_id).isdigit():
        clause = 'AND id > %s'
        params.append(int(after_id))
    rows = query(f"SELECT id,sender_user_id,body,created_at FROM messages WHERE conversation_id=%s {clause} ORDER BY id ASC LIMIT 200", params, many=True) or []
    return JsonResponse({'items': rows})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def inbox_updates(request: HttpRequest, _user=None):
    after_message_id = request.GET.get('after_message_id')
    clause = ''
    params = [_user['id'], _user['id'], _user['id']]
    if after_message_id and str(after_message_id).isdigit():
        clause = 'AND (SELECT MAX(m.id) FROM messages m WHERE m.conversation_id=c.id) > %s'
        params.append(int(after_message_id))
    rows = query(
        f"""
        SELECT c.id,
               (SELECT MAX(m.id) FROM messages m WHERE m.conversation_id=c.id) AS last_message_id,
               (SELECT body FROM messages m2 WHERE m2.conversation_id=c.id ORDER BY m2.id DESC LIMIT 1) AS last_message,
               (SELECT created_at FROM messages m2 WHERE m2.conversation_id=c.id ORDER BY m2.id DESC LIMIT 1) AS last_message_time,
               (SELECT u.full_name FROM conversation_participants cp2 JOIN users u ON u.id=cp2.user_id WHERE cp2.conversation_id=c.id AND cp2.user_id<>%s LIMIT 1) AS partner_name,
               (SELECT cp2.user_id FROM conversation_participants cp2 WHERE cp2.conversation_id=c.id AND cp2.user_id<>%s LIMIT 1) AS partner_user_id,
               COALESCE((SELECT COUNT(1) FROM messages m3 WHERE m3.conversation_id=c.id AND (p.last_read_message_id IS NULL OR m3.id > p.last_read_message_id)),0) AS unread_count
        FROM conversations c
        JOIN conversation_participants p ON p.conversation_id=c.id AND p.user_id=%s
        WHERE 1=1 {clause}
        ORDER BY last_message_id DESC
        LIMIT 100
        """, params, many=True
    ) or []
    total_unread = sum(int(r.get('unread_count') or 0) for r in rows)
    return JsonResponse({'items': rows, 'total_unread': total_unread})

# ---------------------------------------------------------------------------
# Dashboard (Feature 37 partial) – summary counts for quick demo
# ---------------------------------------------------------------------------
@api_view(require_auth=True, methods=['GET'], csrf=False)
def dashboard(request: HttpRequest, _user=None):
    uid = _user['id']
    # Ensure notifications table exists (dev environments may lack it)
    try:
        from .utils import _ensure_notifications_table
        _ensure_notifications_table()
    except Exception:
        pass
    # Notifications (unread count)
    notif_row = query("SELECT COUNT(1) AS c FROM notifications WHERE user_id=%s AND read_at IS NULL", [uid]) or {'c':0}
    # Blood direct open (global)
    bdr_row = query("SELECT COUNT(1) AS c FROM blood_direct_requests WHERE status='open'") or {'c':0}
    # Messaging
    conv_count = query("SELECT COUNT(DISTINCT conversation_id) AS c FROM conversation_participants WHERE user_id=%s", [uid]) or {'c':0}
    msg_total = query("SELECT COUNT(1) AS c FROM messages m JOIN conversation_participants cp ON cp.conversation_id=m.conversation_id AND cp.user_id=%s", [uid]) or {'c':0}
    # Fire service related: if user is fire_service show pending candidates, else pending requests created by user
    fire_role = _user.get('role') == 'fire_service'
    if fire_role:
        dept = query("SELECT id FROM fire_departments WHERE user_id=%s", [uid])
        fire_pending = query("SELECT COUNT(1) AS c FROM fire_request_candidates c JOIN fire_departments d ON d.id=c.department_id WHERE d.user_id=%s AND c.status='pending'", [uid]) if dept else {'c':0}
    else:
        fire_pending = query("SELECT COUNT(1) AS c FROM fire_service_requests WHERE requester_id=%s AND status='pending'", [uid]) or {'c':0}
    # Unread messages aggregate
    unread_row = query("""
        SELECT COALESCE(SUM(unread_part.cnt),0) AS c
        FROM (
            SELECT cp.conversation_id,
                   (SELECT COUNT(1) FROM messages m WHERE m.conversation_id=cp.conversation_id AND (cp.last_read_message_id IS NULL OR m.id > cp.last_read_message_id)) AS cnt
            FROM conversation_participants cp
            WHERE cp.user_id=%s
        ) unread_part
    """, [uid]) or {'c':0}
    return JsonResponse({
        'notifications_unread': int(notif_row['c']),
        'blood_direct_open': int(bdr_row['c']),
        'conversations': int(conv_count['c']),
        'messages_total': int(msg_total['c']),
        'messages_unread': int(unread_row['c']),
        'fire_pending': int(fire_pending['c']),
    })

# ---------------------------------------------------------------------------
# Messaging: mark conversation read
# ---------------------------------------------------------------------------
@api_view(require_auth=True, methods=['POST'], csrf=False)
def conversation_mark_read(request: HttpRequest, conversation_id: int, _user=None):
    # Ensure participant
    part = query("SELECT conversation_id,last_read_message_id FROM conversation_participants WHERE conversation_id=%s AND user_id=%s", [conversation_id, _user['id']])
    if not part:
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    last_message_id = data.get('last_message_id')
    if last_message_id is None or not str(last_message_id).isdigit():
        # Use current max
        lm = query("SELECT MAX(id) AS mid FROM messages WHERE conversation_id=%s", [conversation_id]) or {'mid': None}
        last_message_id = lm['mid'] or 0
    last_message_id = int(last_message_id)
    # Only update forward
    execute("UPDATE conversation_participants SET last_read_message_id = GREATEST(COALESCE(last_read_message_id,0), %s) WHERE conversation_id=%s AND user_id=%s", [last_message_id, conversation_id, _user['id']])
    # Mark related message_new notifications as read
    try:
        execute("UPDATE notifications SET is_read=1, read_at=NOW() WHERE user_id=%s AND type='message_new' AND JSON_EXTRACT(payload,'$.conversation_id')=%s AND is_read=0", [_user['id'], conversation_id])
    except Exception:
        pass
    # Return new unread count (should be 0 unless messages appended during race)
    unread = query("SELECT COUNT(1) AS c FROM messages WHERE conversation_id=%s AND id > (SELECT COALESCE(last_read_message_id,0) FROM conversation_participants WHERE conversation_id=%s AND user_id=%s)", [conversation_id, conversation_id, _user['id']]) or {'c':0}
    return JsonResponse({'ok': True, 'unread_remaining': unread['c']})

# ---------------------------------------------------------------------------
# Phase 1 Core Entities (Breadth) - New Lightweight Endpoints
#   - Campaign Locations (Feature 13 partial)
#   - Fire Teams / Inventory / Staff (Features 14 & 16 partial)
#   - Doctor Notification Preferences (Feature 41 partial)
#   - Food Donations (Feature 23 partial)
# These are intentionally minimal CRUD-style endpoints to establish surface area.
# ---------------------------------------------------------------------------

@api_view(require_auth=True, methods=['POST'], csrf=False)
def add_campaign_location(request: HttpRequest, campaign_id: int, _user=None):
    camp = query("SELECT owner_user_id FROM campaigns WHERE id=%s", [campaign_id])
    if not camp:
        return JsonResponse({'error':'campaign_not_found'}, status=404)
    if camp['owner_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    lat = data.get('lat'); lng = data.get('lng'); label = (data.get('label') or '')[:255] or None
    try:
        execute("INSERT INTO campaign_locations(campaign_id,label,lat,lng) VALUES(%s,%s,%s,%s)", [campaign_id, label, lat, lng])
    except Exception as e:
        return JsonResponse({'error':'insert_failed','detail':str(e)}, status=400)
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_campaign_locations(request: HttpRequest, campaign_id: int, _user=None):
    camp = query("SELECT owner_user_id,status FROM campaigns WHERE id=%s", [campaign_id])
    if not camp:
        return JsonResponse({'error':'campaign_not_found'}, status=404)
    # draft visibility rule same as campaign
    if camp['status']=='draft' and camp['owner_user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    rows = query("SELECT id,label,lat,lng,created_at FROM campaign_locations WHERE campaign_id=%s ORDER BY id DESC", [campaign_id], many=True) or []
    return JsonResponse({'items': rows})

# ---------------- Fire Department Ownership Helper -------------------------
def _require_fire_dept_owner(dept_id: int, user_id: int) -> bool:
    row = query("SELECT id FROM fire_departments WHERE id=%s AND user_id=%s", [dept_id, user_id])
    return bool(row)

@api_view(require_auth=True, methods=['POST'], csrf=False)
def fire_department_add_team(request: HttpRequest, department_id: int, _user=None):
    if not _require_fire_dept_owner(department_id, _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    name = (data.get('name') or '').strip()[:255]
    status = (data.get('status') or 'available')[:32]
    if not name:
        return JsonResponse({'error':'missing_name'}, status=400)
    tid = execute("INSERT INTO fire_teams(department_id,name,status) VALUES(%s,%s,%s)", [department_id, name, status])
    return JsonResponse({'id': tid})

@api_view(methods=['GET'], csrf=False)
def fire_department_list_teams(request: HttpRequest, department_id: int, _user=None):
    """List teams for a department (public-safe).

    - Visible to everyone; returns limited, non-sensitive fields.
    - Includes member_count when membership table exists; otherwise omits it.
    - Never raises 403 for public views.
    """
    rows = query(
        """
        SELECT t.id,t.name,t.status,t.created_at, COALESCE(mc.cnt,0) AS member_count
        FROM fire_teams t
        LEFT JOIN (
          SELECT team_id, COUNT(*) AS cnt FROM fire_team_members GROUP BY team_id
        ) mc ON mc.team_id = t.id
        WHERE t.department_id=%s
        ORDER BY t.id DESC
        """,
        [department_id], many=True
    ) or []
    return JsonResponse({'items': rows})

@api_view(require_auth=True, methods=['POST','DELETE'], csrf=False)
def fire_department_team_item(request: HttpRequest, department_id: int, team_id: int, _user=None):
    if not _require_fire_dept_owner(department_id, _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    team = query("SELECT id FROM fire_teams WHERE id=%s AND department_id=%s", [team_id, department_id])
    if not team:
        return JsonResponse({'error':'not_found'}, status=404)
    if request.method == 'DELETE':
        execute("DELETE FROM fire_team_members WHERE team_id=%s", [team_id])
        execute("DELETE FROM fire_teams WHERE id=%s", [team_id])
        return JsonResponse({'ok': True})
    # POST = update (partial)
    data = json.loads(request.body or '{}')
    sets = []; params = []
    if 'name' in data:
        name = (data.get('name') or '').strip()[:255]
        if not name: return JsonResponse({'error':'missing_name'}, status=400)
        sets.append('name=%s'); params.append(name)
    if 'status' in data:
        status = (data.get('status') or 'available')[:32]
        sets.append('status=%s'); params.append(status)
    if sets:
        params.append(team_id)
        execute("UPDATE fire_teams SET " + ','.join(sets) + " WHERE id=%s", params)
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def fire_department_team_members(request: HttpRequest, department_id: int, team_id: int, _user=None):
    if not _require_fire_dept_owner(department_id, _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
        # Schema assumed present
    rows = query("""
        SELECT m.id,m.team_id,m.staff_id, s.user_id, s.role, s.display_name,
               u.email AS user_email, u.full_name AS user_full_name
        FROM fire_team_members m
        JOIN fire_staff s ON s.id = m.staff_id
        LEFT JOIN users u ON u.id = s.user_id
        JOIN fire_teams t ON t.id = m.team_id AND t.department_id=%s
        WHERE m.team_id=%s
        ORDER BY m.id DESC
    """, [department_id, team_id], many=True) or []
    return JsonResponse({'items': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def fire_department_team_add_member(request: HttpRequest, department_id: int, team_id: int, _user=None):
    if not _require_fire_dept_owner(department_id, _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
        # Schema assumed present
    data = json.loads(request.body or '{}')
    staff_id = int(data.get('staff_id') or 0)
    if not staff_id:
        return JsonResponse({'error':'missing_staff_id'}, status=400)
    # Validate staff belongs to department
    staff = query("SELECT id FROM fire_staff WHERE id=%s AND department_id=%s", [staff_id, department_id])
    if not staff:
        return JsonResponse({'error':'staff_not_found'}, status=404)
    # Validate team
    team = query("SELECT id FROM fire_teams WHERE id=%s AND department_id=%s", [team_id, department_id])
    if not team:
        return JsonResponse({'error':'team_not_found'}, status=404)
    existing = query("SELECT id FROM fire_team_members WHERE team_id=%s AND staff_id=%s", [team_id, staff_id])
    if not existing:
        execute("INSERT INTO fire_team_members(team_id,staff_id) VALUES(%s,%s)", [team_id, staff_id])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['DELETE'], csrf=False)
def fire_department_team_remove_member(request: HttpRequest, department_id: int, team_id: int, member_id: int, _user=None):
    if not _require_fire_dept_owner(department_id, _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
        # Schema assumed present
    # Ensure team belongs to department
    team = query("SELECT id FROM fire_teams WHERE id=%s AND department_id=%s", [team_id, department_id])
    if not team:
        return JsonResponse({'error':'team_not_found'}, status=404)
    execute("DELETE FROM fire_team_members WHERE id=%s", [member_id])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def fire_department_add_inventory(request: HttpRequest, department_id: int, _user=None):
    if not _require_fire_dept_owner(department_id, _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    item_name = (data.get('item_name') or '').strip()[:255]
    qty = int(data.get('quantity') or 0)
    if not item_name:
        return JsonResponse({'error':'missing_item_name'}, status=400)
    iid = execute("INSERT INTO fire_inventory(department_id,item_name,quantity) VALUES(%s,%s,%s)", [department_id, item_name, qty])
    return JsonResponse({'id': iid})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def fire_department_list_inventory(request: HttpRequest, department_id: int, _user=None):
    if not _require_fire_dept_owner(department_id, _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    rows = query("SELECT id,item_name,quantity,created_at FROM fire_inventory WHERE department_id=%s ORDER BY id DESC", [department_id], many=True) or []
    return JsonResponse({'items': rows})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def fire_department_add_staff(request: HttpRequest, department_id: int, _user=None):
    if not _require_fire_dept_owner(department_id, _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    user_id = data.get('user_id')
    role = (data.get('role') or '')[:64] or None
    display_name = (data.get('display_name') or '').strip()[:255] or None
    if not user_id:
        return JsonResponse({'error':'missing_user_id'}, status=400)
    existing = query("SELECT id FROM fire_staff WHERE department_id=%s AND user_id=%s", [department_id, user_id])
    if not existing:
        execute("INSERT INTO fire_staff(department_id,user_id,role,display_name) VALUES(%s,%s,%s,%s)", [department_id, user_id, role, display_name])
    else:
        # Optional: update role/display_name if already exists
        execute("UPDATE fire_staff SET role=%s, display_name=COALESCE(%s,display_name) WHERE id=%s", [role, display_name, existing['id']])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['DELETE'], csrf=False)
def fire_department_remove_staff(request: HttpRequest, department_id: int, user_id: int, _user=None):
    if not _require_fire_dept_owner(department_id, _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    execute("DELETE FROM fire_staff WHERE department_id=%s AND user_id=%s", [department_id, user_id])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def fire_department_update_staff(request: HttpRequest, department_id: int, user_id: int, _user=None):
    if not _require_fire_dept_owner(department_id, _user['id']):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    role = (data.get('role') or '')[:64] or None
    # 'status' column no longer exists on fire_staff; ignore if provided
    display_name = (data.get('display_name') or '').strip()[:255] or None
    existing = query("SELECT id FROM fire_staff WHERE department_id=%s AND user_id=%s", [department_id, user_id])
    if not existing:
        return JsonResponse({'error':'not_found'}, status=404)
    sets = []
    params = []
    if role is not None:
        sets.append('role=%s'); params.append(role)
    if display_name is not None:
        sets.append('display_name=%s'); params.append(display_name)
    if not sets:
        return JsonResponse({'ok': True})
    params.extend([department_id, user_id])
    execute("UPDATE fire_staff SET " + ','.join(sets) + " WHERE department_id=%s AND user_id=%s", params)
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def fire_department_list_staff(request: HttpRequest, department_id: int, _user=None):
    # Public read-only staff list (limited fields)
    rows = query("""
        SELECT s.id,s.user_id,s.role,s.display_name,s.created_at,
               u.full_name AS user_full_name
        FROM fire_staff s
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.department_id=%s
        ORDER BY s.id DESC
        """, [department_id], many=True) or []
    return JsonResponse({'items': rows})

# Lightweight user search for selection UIs: ?q=term
@api_view(require_auth=True, methods=['GET'], csrf=False)
def search_users(request: HttpRequest, _user=None):
    q = (request.GET.get('q') or '').strip()
    if not q:
        return JsonResponse({'results': []})
    like = q + '%'
    try:
        # Include role to help client map org type; keep projection minimal
        rows = query(
            "SELECT id,email,full_name,role FROM users WHERE email LIKE %s OR full_name LIKE %s ORDER BY id DESC LIMIT 20",
            [like, like], many=True
        ) or []
    except Exception:
        # If search fails for any reason (e.g., schema drift), degrade gracefully
        rows = []
    return JsonResponse({'results': rows})

# Doctor notification preferences (simple toggle)
@api_view(require_auth=True, methods=['GET'], csrf=False)
def doctor_prefs_get(request: HttpRequest, _user=None):
    # Table doctor_notification_prefs may not exist in normalized schema; degrade gracefully.
    try:
        row = query("SELECT notify_appointments FROM doctor_notification_prefs WHERE doctor_user_id=%s", [_user['id']])
        if not row:
            return JsonResponse({'doctor_user_id': _user['id'], 'notify_appointments': 1})
        return JsonResponse({'doctor_user_id': _user['id'], 'notify_appointments': int(row['notify_appointments'])})
    except Exception:
        # Default to enabled notifications without hitting DB
        return JsonResponse({'doctor_user_id': _user['id'], 'notify_appointments': 1})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def doctor_prefs_set(request: HttpRequest, _user=None):
    data = json.loads(request.body or '{}')
    val = 1 if data.get('notify_appointments', True) else 0
    try:
        existing = query("SELECT id FROM doctor_notification_prefs WHERE doctor_user_id=%s", [_user['id']])
        if existing:
            execute("UPDATE doctor_notification_prefs SET notify_appointments=%s WHERE doctor_user_id=%s", [val, _user['id']])
        else:
            execute("INSERT INTO doctor_notification_prefs(doctor_user_id,notify_appointments) VALUES(%s,%s)", [_user['id'], val])
        return JsonResponse({'ok': True, 'notify_appointments': val})
    except Exception:
        # No-op when table absent; avoid 500 and report effective value
        return JsonResponse({'ok': True, 'notify_appointments': val, 'persisted': False})

# Food donations
@api_view(require_auth=True, methods=['POST'], csrf=False)
def create_food_donation(request: HttpRequest, _user=None):
    data = json.loads(request.body or '{}')
    item = (data.get('item') or '').strip()[:255]
    quantity = int(data.get('quantity') or 1)
    status = (data.get('status') or 'offered')[:32]
    notes = data.get('notes')
    event_id = data.get('event_id')
    organization_id = data.get('organization_id')
    if not item:
        return JsonResponse({'error':'missing_item'}, status=400)
    params = [_user['id'], event_id, item, quantity, status, notes, organization_id]
    try:
        did = execute("INSERT INTO food_donations(donor_user_id,event_id,item,quantity,status,notes,organization_id) VALUES(%s,%s,%s,%s,%s,%s,%s)", params)
        return JsonResponse({'id': did, 'ok': True})
    except Exception:
        # Feature not available in normalized schema; avoid 500s
        return JsonResponse({'ok': False, 'error': 'feature_disabled'}, status=200)

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_food_donations(request: HttpRequest, _user=None):
    status_f = request.GET.get('status')
    org = request.GET.get('organization_id')
    where_clauses = []
    params = []
    if status_f:
        where_clauses.append('status=%s'); params.append(status_f)
    if org:
        where_clauses.append('organization_id=%s'); params.append(org)
    where_sql = (' WHERE ' + ' AND '.join(where_clauses)) if where_clauses else ''
    try:
        rows = query("SELECT id,event_id,item,quantity,status,notes,organization_id,created_at FROM food_donations" + where_sql + " ORDER BY id DESC LIMIT 100", params, many=True) or []
        return JsonResponse({'items': rows})
    except Exception:
        # Table not present; return empty list gracefully
        return JsonResponse({'items': []})

# ---------------------------------------------------------------------------
# Breadth-first Emergency Events (Feature 17 stub)
# ---------------------------------------------------------------------------
@api_view(require_auth=True, methods=['POST'], csrf=False)
def create_event(request: HttpRequest, _user=None):
    # Allow admin or any user for breadth prototype (later restrict).
    data = json.loads(request.body or '{}')
    title = (data.get('title') or '')[:255]
    ev_type = (data.get('type') or '')[:32]
    status = 'open'
    eid = execute("INSERT INTO emergency_events(admin_id,type,title,status) VALUES(%s,%s,%s,%s)", [_user['id'], ev_type, title, status])
    return JsonResponse({'id': eid})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_events(request: HttpRequest, _user=None):
    rows = query("SELECT id,type,title,status,created_at FROM emergency_events ORDER BY id DESC LIMIT 50", many=True) or []
    return JsonResponse({'items': rows})


# ============================= NOTIFICATIONS API ==============================
@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_notifications(request: HttpRequest, _user=None):
    """List notifications for the current user with pagination.

    Supports optional query params:
      - unread=1 (only unread)
      - type=... (filter by type)
      - before_id=... (legacy slice behavior with limit)
      - page, page_size (standard pagination via paginate helper)

    If before_id is provided with legacy limit, the response mimics a single-page slice.
    """
    from .utils import paginate, _ensure_notifications_table
    try:
        _ensure_notifications_table()
    except Exception:
        pass
    unread = request.GET.get('unread')
    before_id = request.GET.get('before_id')
    ntype = request.GET.get('type')
    where = ['user_id=%s']
    params = [_user['id']]
    if unread == '1':
        where.append('is_read=0')
    if ntype:
        where.append('type=%s'); params.append(ntype)
    if before_id:
        where.append('id<%s'); params.append(before_id)
    base_sql = 'SELECT id,type,payload,is_read,read_at,created_at FROM notifications WHERE ' + ' AND '.join(where)
    order_fragment = ' ORDER BY id DESC'

    # Legacy limit mapping if user supplied ?limit and not explicit page_size
    if 'limit' in request.GET and 'page_size' not in request.GET:
        try:
            forced_size = int(request.GET.get('limit') or 20)
        except Exception:
            forced_size = 20
        forced_size = max(1, min(forced_size, 200))
        if before_id:
            rows = query(base_sql + order_fragment + ' LIMIT %s', params + [forced_size], many=True) or []
            for r in rows:
                if r.get('payload'):
                    try:
                        r['payload'] = json.loads(r['payload'])
                    except Exception:
                        pass
            return JsonResponse({'results': rows, 'page': 1, 'page_size': forced_size, 'total': len(rows), 'has_next': len(rows)==forced_size, 'has_prev': False, 'next_page': 2 if len(rows)==forced_size else None, 'prev_page': None})
        # Else, paginate with a forced page_size by proxying GET
        class _ReqWrap:
            GET = {}
        rw = _ReqWrap()
        rw.GET = dict(request.GET)
        rw.GET['page_size'] = [str(forced_size)] if isinstance(rw.GET.get('page_size'), list) else str(forced_size)
        rows, meta = paginate(rw, base_sql, params, order_fragment=order_fragment)
    else:
        rows, meta = paginate(request, base_sql, params, order_fragment=order_fragment)

    for r in rows:
        if r.get('payload'):
            try:
                r['payload'] = json.loads(r['payload'])
            except Exception:
                pass
    return JsonResponse({'results': rows, **meta})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def mark_notification_read(request: HttpRequest, notif_id: int, _user=None):
    try:
        from .utils import _ensure_notifications_table
        _ensure_notifications_table()
    except Exception:
        pass
    row = query("SELECT user_id,is_read FROM notifications WHERE id=%s", [notif_id])
    if not row:
        return JsonResponse({'error':'not_found'}, status=404)
    if row['user_id'] != _user['id']:
        return JsonResponse({'error':'forbidden'}, status=403)
    if row['is_read']:
        return JsonResponse({'ok': True, 'already': True})
    execute("UPDATE notifications SET is_read=1, read_at=NOW() WHERE id=%s", [notif_id])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def mark_all_notifications_read(request: HttpRequest, _user=None):
    try:
        from .utils import _ensure_notifications_table
        _ensure_notifications_table()
    except Exception:
        pass
    execute("UPDATE notifications SET is_read=1, read_at=NOW() WHERE user_id=%s AND is_read=0", [_user['id']])
    return JsonResponse({'ok': True})

# ============================= INCIDENTS (UNIFIED EVENTS) ==============================

INCIDENT_STATUSES = ('open','monitoring','mitigated','closed','cancelled')
INCIDENT_STATUS_TRANSITIONS = {
    'open': {'monitoring','mitigated','closed','cancelled'},
    'monitoring': {'mitigated','closed','cancelled'},
    'mitigated': {'closed'},
    'closed': set(),
    'cancelled': set(),
}

# Any authenticated user can request an incident by policy; keep org roles and include regular users.
ALLOWED_INCIDENT_CREATOR_ROLES = {'hospital','fire_service','social_org','social_service','blood_bank','admin','regular'}

def _can_create_incident(user):
    return user and user.get('role') in ALLOWED_INCIDENT_CREATOR_ROLES

@api_view(require_auth=True, methods=['POST'], csrf=False)
def create_incident(request: HttpRequest, _user=None):
    if not _can_create_incident(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    title = _limit_str(data.get('title','').strip(),255)
    if not title:
        return JsonResponse({'error':'missing_title'}, status=400)
    description = data.get('description')
    itype = _limit_str(data.get('incident_type','general'),50)
    severity = _limit_str(data.get('severity','') or None,20) if data.get('severity') else None
    lat = data.get('lat'); lng = data.get('lng')
    iid = execute("INSERT INTO incidents(creator_user_id,title,description,incident_type,severity,lat,lng) VALUES(%s,%s,%s,%s,%s,%s,%s)", [_user['id'], title, description, itype, severity, lat, lng])
    try:
        _notify(_user['id'], 'incident_created', {'incident_id': iid})
    except Exception:
        pass
    # auto add creator as active participant
    try:
        execute("INSERT INTO incident_participants(incident_id,user_id,role_label,status) VALUES(%s,%s,%s,'active')", [iid, _user['id'], 'creator'])
    except Exception:
        pass
    return JsonResponse({'id': iid})

@api_view(methods=['GET'], csrf=False)
def list_incidents(request: HttpRequest, _user=None):
    from .utils import paginate
    status_f = request.GET.get('status')
    itype = request.GET.get('type')
    severity = request.GET.get('severity')
    where=[]; params=[]
    if status_f:
        where.append('status=%s'); params.append(status_f)
    if itype:
        where.append('incident_type=%s'); params.append(itype)
    if severity:
        where.append('severity=%s'); params.append(severity)
    base='SELECT id,title,incident_type,status,severity,opened_at,updated_at,lat,lng FROM incidents'
    if where:
        base += ' WHERE ' + ' AND '.join(where)
    rows, meta = paginate(request, base, params, order_fragment=' ORDER BY opened_at DESC')
    return JsonResponse({'results': rows, **meta})

@api_view(methods=['GET'], csrf=False)
def get_incident(request: HttpRequest, incident_id: int, _user=None):
    row = query("SELECT * FROM incidents WHERE id=%s", [incident_id])
    if not row:
        return JsonResponse({'error':'not_found'}, status=404)
    return JsonResponse(row)

@api_view(require_auth=True, methods=['POST'], csrf=False)
def change_incident_status(request: HttpRequest, incident_id: int, _user=None):
    inc = query("SELECT * FROM incidents WHERE id=%s", [incident_id])
    if not inc:
        return JsonResponse({'error':'not_found'}, status=404)
    # Only creator or admin can change status
    if inc['creator_user_id'] != _user['id'] and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    new_status = data.get('status')
    if new_status not in INCIDENT_STATUSES:
        return JsonResponse({'error':'invalid_status'}, status=400)
    allowed = INCIDENT_STATUS_TRANSITIONS.get(inc['status'], set())
    if new_status not in allowed:
        return JsonResponse({'error':'invalid_transition','from':inc['status'],'to':new_status}, status=400)
    execute("UPDATE incidents SET status=%s, updated_at=NOW(), closed_at=NOW() WHERE id=%s", [new_status, incident_id])
    try:
        _notify(inc['creator_user_id'], 'incident_status', {'incident_id': incident_id,'status': new_status})
    except Exception:
        pass
    try:
        execute("INSERT INTO incident_events(incident_id,user_id,event_type,note) VALUES(%s,%s,%s,%s)", [incident_id, _user['id'], 'status_change', f"{inc['status']} -> {new_status}"])
    except Exception:
        pass
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def incident_add_note(request: HttpRequest, incident_id: int, _user=None):
    inc = query("SELECT id FROM incidents WHERE id=%s", [incident_id])
    if not inc:
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    note = _limit_str(data.get('note',''), 2000)
    if not note:
        return JsonResponse({'error':'missing_note'}, status=400)
    execute("INSERT INTO incident_events(incident_id,user_id,event_type,note) VALUES(%s,%s,'note',%s)", [incident_id, _user['id'], note])
    return JsonResponse({'ok': True})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def join_incident(request: HttpRequest, incident_id: int, _user=None):
    inc = query("SELECT id,status FROM incidents WHERE id=%s", [incident_id])
    if not inc:
        return JsonResponse({'error':'not_found'}, status=404)
    if inc['status'] in ('closed','cancelled'):
        return JsonResponse({'error':'not_joinable'}, status=400)
    existing = query("SELECT id,status FROM incident_participants WHERE incident_id=%s AND user_id=%s", [incident_id, _user['id']])
    if existing:
        if existing['status']=='active':
            return JsonResponse({'error':'already_participant'}, status=400)
        execute("UPDATE incident_participants SET status='active' WHERE id=%s", [existing['id']])
        return JsonResponse({'id': existing['id'], 'rejoined': True})
    data = json.loads(request.body or '{}')
    role_label = _limit_str(data.get('role_label','') or None, 50) if data.get('role_label') else None
    pid = execute("INSERT INTO incident_participants(incident_id,user_id,role_label,status) VALUES(%s,%s,%s,'active')", [incident_id, _user['id'], role_label])
    return JsonResponse({'id': pid})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def withdraw_incident(request: HttpRequest, incident_id: int, _user=None):
    part = query("SELECT * FROM incident_participants WHERE incident_id=%s AND user_id=%s", [incident_id, _user['id']])
    if not part:
        return JsonResponse({'error':'not_participant'}, status=404)
    if part['status']=='withdrawn':
        return JsonResponse({'ok': True, 'already': True})
    execute("UPDATE incident_participants SET status='withdrawn' WHERE id=%s", [part['id']])
    return JsonResponse({'ok': True})

@api_view(methods=['GET'], csrf=False)
def list_incident_events(request: HttpRequest, incident_id: int, _user=None):
    from .utils import paginate
    base = 'SELECT id,event_type,user_id,note,created_at FROM incident_events WHERE incident_id=%s'
    rows, meta = paginate(request, base, [incident_id], order_fragment=' ORDER BY id ASC')
    return JsonResponse({'results': rows, **meta})

@api_view(methods=['GET'], csrf=False)
def list_incident_participants(request: HttpRequest, incident_id: int, _user=None):
    from .utils import paginate
    with_users = str(request.GET.get('with_users') or '').lower() in ('1','true','yes')
    if with_users:
        base = (
            "SELECT ip.id, ip.user_id, ip.role_label, ip.status, ip.joined_at, "
            "u.full_name AS user_name, u.avatar_url "
            "FROM incident_participants ip "
            "LEFT JOIN users u ON u.id = ip.user_id "
            "WHERE ip.incident_id=%s AND ip.status='active'"
        )
        order = ' ORDER BY ip.id ASC'
    else:
        base = "SELECT id,user_id,role_label,status,joined_at FROM incident_participants WHERE incident_id=%s AND status='active'"
        order = ' ORDER BY id ASC'
    rows, meta = paginate(request, base, [incident_id], order_fragment=order)
    return JsonResponse({'results': rows, **meta})

@api_view(require_auth=True, methods=['DELETE'], csrf=False)
def delete_incident_participant(request: HttpRequest, incident_id: int, participant_id: int, _user=None):
    """Admin-only (or incident creator): hard delete a participant record from an incident.
    This allows removing mistakenly added or abusive participants.
    """
    # Verify incident exists and actor is allowed (creator or admin)
    inc = query("SELECT id, creator_user_id FROM incidents WHERE id=%s", [incident_id])
    if not inc:
        return JsonResponse({'error': 'not_found'}, status=404)
    if inc['creator_user_id'] != _user['id'] and not _require_admin(_user):
        return JsonResponse({'error': 'forbidden'}, status=403)
    # Ensure participant belongs to this incident
    part = query("SELECT id, user_id FROM incident_participants WHERE id=%s AND incident_id=%s", [participant_id, incident_id])
    if not part:
        return JsonResponse({'error': 'not_found'}, status=404)
    execute("DELETE FROM incident_participants WHERE id=%s", [participant_id])
    # Keep participation request state consistent: mark the latest accepted request as revoked
    try:
        cr = query("SELECT id FROM crises WHERE incident_id=%s", [incident_id])
        if cr and part.get('user_id'):
            execute(
                "UPDATE crisis_participation_requests SET status='revoked' WHERE id=(SELECT id FROM (SELECT id FROM crisis_participation_requests WHERE crisis_id=%s AND user_id=%s AND status IN ('accepted','approved') ORDER BY id DESC LIMIT 1) t)",
                [cr['id'], part['user_id']]
            )
    except Exception:
        pass
    return JsonResponse({'ok': True, 'deleted': True})

# ============================= INCIDENT HOSPITAL RESOURCES ==============================

def _ensure_incident_hospital_resources():
    # No-op: final schema includes incident_hospital_resources.
    return None

def _is_incident_participant(user_id: int, incident_id: int):
    row = query("SELECT id FROM incident_participants WHERE incident_id=%s AND user_id=%s AND status='active'", [incident_id, user_id])
    return bool(row)

# ================= INCIDENT SOCIAL VOLUNTEER DEPLOYMENTS =================

def _is_social_org(user):
    role = str((user or {}).get('role') or '').lower()
    return role in ('social_org','social_service','ngo','org')

def _ensure_incident_social_deployments():
    # No-op: final schema includes incident_social_deployments.
    return None

def _ensure_incident_social_deployment_members():
    # No-op: final schema includes incident_social_deployment_members and its unique index.
    return None

@api_view(require_auth=True, methods=['POST'], csrf=False)
def incident_social_deploy(request: HttpRequest, incident_id: int, _user=None):
    """Deploy a social organization's volunteers to an incident.

    Body: { headcount: int, capabilities?: string, note?: string }
    Permissions: social org owner (social_organizations.user_id == me) and must be an active incident participant.
    Side effect: logs to incident_events and returns created record id.
    """
    if not (_is_social_org(_user) or _require_admin(_user)):
        return JsonResponse({'error':'forbidden'}, status=403)
    inc = query('SELECT id,status FROM incidents WHERE id=%s', [incident_id])
    if not inc:
        return JsonResponse({'error':'not_found'}, status=404)
    if inc['status'] in ('closed','cancelled'):
        return JsonResponse({'error':'not_joinable'}, status=400)
    # Determine org id owned by this social user
    if not _require_admin(_user):
        org = query('SELECT id FROM social_organizations WHERE user_id=%s LIMIT 1', [_user['id']])
        if not org:
            return JsonResponse({'error':'org_not_found'}, status=404)
        org_id = org['id']
    else:
        # Admin path: allow ?org_id for acting on behalf
        try:
            org_id = int(request.GET.get('org_id') or 0)
        except Exception:
            org_id = 0
        if not org_id:
            return JsonResponse({'error':'missing_org_id'}, status=400)
    if not _require_admin(_user) and not _is_incident_participant(_user['id'], incident_id):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    # Optional explicit volunteer selection
    volunteer_user_ids = []
    if isinstance(data.get('volunteer_user_ids'), list):
        try:
            volunteer_user_ids = [int(x) for x in data.get('volunteer_user_ids') if str(x).isdigit()]
        except Exception:
            volunteer_user_ids = []
    try:
        headcount = int(data.get('headcount') or 0)
    except Exception:
        headcount = 0
    # If concrete volunteers provided, process and derive headcount after filtering allowed and already-active members
    filtered_selection = []
    skipped_already_active = []
    if volunteer_user_ids:
        # Dedupe order-preserving
        seen = set()
        selection = []
        for uid in volunteer_user_ids:
            if uid in seen: continue
            seen.add(uid)
            selection.append(uid)
        _ensure_social_org_volunteers_table()
        # fetch accepted volunteers for this org
        allowed = query("SELECT user_id, role_label, status FROM social_org_volunteers WHERE org_id=%s AND status IN ('accepted','active')", [org_id], many=True) or []
        allowed_ids = {int(r['user_id']): (r.get('role_label') or None) for r in allowed}
        allowed_selection = [uid for uid in selection if uid in allowed_ids]
        if allowed_selection:
            # Remove volunteers already active in this incident for this org
            placeholders = ','.join(['%s'] * len(allowed_selection))
            try:
                rows = query(
                    "SELECT m.user_id FROM incident_social_deployment_members m "
                    "JOIN incident_social_deployments d ON d.id=m.deployment_id "
                    "WHERE d.incident_id=%s AND d.org_id=%s AND d.status='active' AND m.user_id IN ("+placeholders+")",
                    [incident_id, org_id] + allowed_selection, many=True) or []
                active_ids = {int(r['user_id']) for r in rows}
            except Exception:
                active_ids = set()
            filtered_selection = [uid for uid in allowed_selection if uid not in active_ids]
            skipped_already_active = [uid for uid in allowed_selection if uid in active_ids]
        else:
            filtered_selection = []
        # Derive headcount from filtered list
        headcount = len(filtered_selection)
        if headcount <= 0:
            return JsonResponse({'error': 'volunteers_already_active', 'already_active_user_ids': skipped_already_active}, status=400)
    # No explicit volunteers, ensure headcount is a positive integer
    if headcount <= 0:
        return JsonResponse({'error':'invalid_headcount'}, status=400)
    capabilities = _limit_str(data.get('capabilities') or None, 2000) if data.get('capabilities') is not None else None
    note = _limit_str(data.get('note') or None, 1000) if data.get('note') is not None else None
    _ensure_incident_social_deployments()
    did = execute(
        'INSERT INTO incident_social_deployments(incident_id,org_id,deployed_by_user_id,headcount,capabilities,note) VALUES(%s,%s,%s,%s,%s,%s)',
        [incident_id, org_id, _user['id'], headcount, capabilities, note]
    )
    # If volunteers were specified (after filtering), attach them
    if volunteer_user_ids:
        _ensure_incident_social_deployment_members()
        # Map roles for filtered selection
        try:
            # If allowed_ids not in scope (exception branch), recompute
            allowed = query("SELECT user_id, role_label FROM social_org_volunteers WHERE org_id=%s AND status IN ('accepted','active')", [org_id], many=True) or []
            allowed_ids_local = {int(r['user_id']): (r.get('role_label') or None) for r in allowed}
        except Exception:
            allowed_ids_local = {}
        inserted = 0
        for uid in filtered_selection:
            role_label = allowed_ids_local.get(uid)
            try:
                execute('INSERT INTO incident_social_deployment_members(deployment_id,user_id,role_label) VALUES(%s,%s,%s)', [did, uid, role_label])
                inserted += 1
            except Exception:
                continue
        # Adjust headcount if insertions mismatched for any reason
        if inserted != headcount:
            try:
                execute('UPDATE incident_social_deployments SET headcount=%s WHERE id=%s', [inserted, did])
                headcount = inserted
            except Exception:
                pass
    # Log activity (best-effort)
    try:
        oname = query('SELECT name FROM social_organizations WHERE id=%s', [org_id]) or {}
        label = oname.get('name') or f'Org #{org_id}'
        msg = f"[Social Deployment] {label} deployed {headcount} volunteers"
        # Try to include up to 3 member names for context
        try:
            if volunteer_user_ids and filtered_selection:
                names = query(
                    'SELECT full_name AS n FROM users WHERE id IN (' + ','.join(['%s']*min(len(filtered_selection),3)) + ')',
                    filtered_selection[:3], many=True) or []
                nan = [r.get('n') for r in names if r.get('n')]
                if nan:
                    msg += ' (' + ', '.join(nan) + ('…' if len(filtered_selection) > 3 else '') + ')'
        except Exception:
            pass
        if note:
            msg += f" — {note}"
        execute('INSERT INTO incident_events(incident_id,user_id,event_type,note) VALUES(%s,%s,\'note\',%s)', [incident_id, _user['id'], msg])
    except Exception:
        pass
    return JsonResponse({'ok': True, 'id': did})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_incident_social_deployments(request: HttpRequest, incident_id: int, _user=None):
    """List social org volunteer deployments for an incident (public-safe).
    Supports with_users=1 to include deployed-by user fields and org name.
    """
    _ensure_incident_social_deployments()
    from .utils import paginate
    with_users = str(request.GET.get('with_users') or '').lower() in ('1','true','yes')
    with_members = str(request.GET.get('with_members') or '').lower() in ('1','true','yes')
    if with_users:
        base = (
            "SELECT d.id,d.incident_id,d.org_id,d.deployed_by_user_id,d.headcount,d.capabilities,d.note,d.status,d.created_at, "
            "o.name AS org_name, u.full_name AS deployed_by_name, u.email AS deployed_by_email "
            "FROM incident_social_deployments d "
            "LEFT JOIN social_organizations o ON o.id=d.org_id "
            "LEFT JOIN users u ON u.id=d.deployed_by_user_id "
            "WHERE d.incident_id=%s"
        )
    else:
        base = (
            "SELECT d.id,d.incident_id,d.org_id,d.deployed_by_user_id,d.headcount,d.capabilities,d.note,d.status,d.created_at, "
            "o.name AS org_name "
            "FROM incident_social_deployments d LEFT JOIN social_organizations o ON o.id=d.org_id WHERE d.incident_id=%s"
        )
    rows, meta = paginate(request, base, [incident_id], order_fragment=' ORDER BY d.id DESC')
    if with_members and rows:
        _ensure_incident_social_deployment_members()
        ids = [int(r['id']) for r in rows]
        # Build a single query for all members
        placeholders = ','.join(['%s'] * len(ids))
        try:
            mrows = query(
                "SELECT m.deployment_id, m.user_id, m.role_label, u.full_name, u.email, u.avatar_url FROM incident_social_deployment_members m LEFT JOIN users u ON u.id=m.user_id WHERE m.deployment_id IN ("+placeholders+")",
                ids, many=True) or []
            groups = {}
            for mr in mrows:
                groups.setdefault(int(mr['deployment_id']), []).append({
                    'user_id': mr.get('user_id'),
                    'role_label': mr.get('role_label'),
                    'full_name': mr.get('full_name'),
                    'email': mr.get('email'),
                    'avatar_url': mr.get('avatar_url'),
                })
            for r in rows:
                r['members'] = groups.get(int(r['id']), [])
        except Exception:
            for r in rows:
                r['members'] = []
    return JsonResponse({'results': rows, **meta})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def incident_social_deployment_status(request: HttpRequest, incident_id: int, deployment_id: int, _user=None):
    """Update social deployment status: active -> completed | withdrawn.
    Permissions: Admin or org owner (social_organizations.user_id == me) or original deployer.
    Logs an incident_events note.
    """
    _ensure_incident_social_deployments()
    dep = query('SELECT * FROM incident_social_deployments WHERE id=%s AND incident_id=%s', [deployment_id, incident_id])
    if not dep:
        return JsonResponse({'error':'not_found'}, status=404)
    allowed = False
    if _require_admin(_user):
        allowed = True
    else:
        try:
            owner = query('SELECT user_id FROM social_organizations WHERE id=%s', [dep['org_id']])
            if owner and int(owner.get('user_id')) == int(_user['id']):
                allowed = True
        except Exception:
            pass
        if not allowed and int(dep.get('deployed_by_user_id')) == int(_user['id']):
            allowed = True
    if not allowed:
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    status = (data.get('status') or '').strip().lower()
    if status not in ('completed','withdrawn'):
        return JsonResponse({'error':'invalid_status'}, status=400)
    execute("UPDATE incident_social_deployments SET status=%s WHERE id=%s", [status, deployment_id])
    try:
        oname = query('SELECT name FROM social_organizations WHERE id=%s', [dep['org_id']]) or {}
        label = oname.get('name') or f'Org #{dep["org_id"]}'
        msg = f"[Social Deployment] {label} {status} (headcount: {dep.get('headcount')})"
        execute('INSERT INTO incident_events(incident_id,user_id,event_type,note) VALUES(%s,%s,\'note\',%s)', [incident_id, _user['id'], msg])
    except Exception:
        pass
    return JsonResponse({'ok': True, 'status': status})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def hospital_incident_resources_mine(request: HttpRequest, incident_id: int, _user=None):
    """Hospital user fetches their own resources record for an incident."""
    if not (_require_hospital(_user) or _require_admin(_user)):
        return JsonResponse({'error': 'forbidden'}, status=403)
    _ensure_incident_hospital_resources()
    if not _require_admin(_user) and not _is_incident_participant(_user['id'], incident_id):
        # Require that hospital has joined the incident
        return JsonResponse({'error': 'forbidden'}, status=403)
    row = query("SELECT * FROM incident_hospital_resources WHERE incident_id=%s AND hospital_user_id=%s", [incident_id, _user['id']]) or {}
    return JsonResponse(row)

@api_view(require_auth=True, methods=['POST'], csrf=False)
def hospital_incident_resources_set(request: HttpRequest, incident_id: int, _user=None):
    """Hospital user upserts their resources for an incident.
    Body: { available_beds?: int, doctors?: string, services?: string }
    """
    if not (_require_hospital(_user) or _require_admin(_user)):
        return JsonResponse({'error': 'forbidden'}, status=403)
    _ensure_incident_hospital_resources()
    if not _require_admin(_user) and not _is_incident_participant(_user['id'], incident_id):
        return JsonResponse({'error': 'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    beds = data.get('available_beds')
    if beds is not None:
        try:
            beds = int(beds)
        except Exception:
            return JsonResponse({'error': 'invalid_beds'}, status=400)
    doctors = _limit_str(data.get('doctors') or None, 2000) if data.get('doctors') is not None else None
    services = _limit_str(data.get('services') or None, 2000) if data.get('services') is not None else None
    existing = query("SELECT id FROM incident_hospital_resources WHERE incident_id=%s AND hospital_user_id=%s", [incident_id, _user['id']])
    if existing:
        sets = []
        params = []
        if beds is not None:
            sets.append('available_beds=%s'); params.append(beds)
        if data.get('doctors') is not None:
            sets.append('doctors=%s'); params.append(doctors)
        if data.get('services') is not None:
            sets.append('services=%s'); params.append(services)
        if not sets:
            return JsonResponse({'error': 'no_fields'}, status=400)
        params.append(existing['id'])
        execute("UPDATE incident_hospital_resources SET "+','.join(sets)+" WHERE id=%s", params)
        res_id = existing['id']
    else:
        res_id = execute(
            "INSERT INTO incident_hospital_resources(incident_id,hospital_user_id,available_beds,doctors,services) VALUES(%s,%s,%s,%s,%s)",
            [incident_id, _user['id'], beds, doctors, services]
        )
    # Optionally post an activity note summarizing changes (non-fatal)
    try:
        summary = []
        if beds is not None: summary.append(f"beds={beds}")
        if doctors is not None: summary.append("doctors updated")
        if services is not None: summary.append("services updated")
        if summary:
            execute("INSERT INTO incident_events(incident_id,user_id,event_type,note) VALUES(%s,%s,'note',%s)", [incident_id, _user['id'], '[Hospital Resources] ' + ', '.join(summary)])
    except Exception:
        pass
    return JsonResponse({'ok': True, 'id': res_id})

@api_view(require_auth=True, methods=['POST','DELETE'], csrf=False)
def hospital_incident_resources_delete(request: HttpRequest, incident_id: int, _user=None):
    """Hospital user deletes their own resources record for an incident."""
    if not (_require_hospital(_user) or _require_admin(_user)):
        return JsonResponse({'error': 'forbidden'}, status=403)
    _ensure_incident_hospital_resources()
    if not _require_admin(_user) and not _is_incident_participant(_user['id'], incident_id):
        return JsonResponse({'error': 'forbidden'}, status=403)
    execute("DELETE FROM incident_hospital_resources WHERE incident_id=%s AND hospital_user_id=%s", [incident_id, _user['id']])
    return JsonResponse({'ok': True, 'deleted': True})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_incident_hospital_resources(request: HttpRequest, incident_id: int, _user=None):
    """Admin-only: list all hospital resources for an incident (with optional user enrichment)."""
    if not _require_admin(_user):
        return JsonResponse({'error': 'forbidden'}, status=403)
    _ensure_incident_hospital_resources()
    with_users = str(request.GET.get('with_users') or '').lower() in ('1','true','yes')
    from .utils import paginate
    if with_users:
        base = (
            "SELECT r.id, r.incident_id, r.hospital_user_id, r.available_beds, r.doctors, r.services, r.created_at, r.updated_at, "
            "u.full_name AS hospital_name, u.email AS hospital_email, u.avatar_url AS hospital_avatar_url "
            "FROM incident_hospital_resources r LEFT JOIN users u ON u.id=r.hospital_user_id WHERE r.incident_id=%s"
        )
        order = ' ORDER BY r.id DESC'
    else:
        base = "SELECT id,incident_id,hospital_user_id,available_beds,doctors,services,created_at,updated_at FROM incident_hospital_resources WHERE incident_id=%s"
        order = ' ORDER BY id DESC'
    rows, meta = paginate(request, base, [incident_id], order_fragment=order)
    return JsonResponse({'results': rows, **meta})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_incident_hospital_resources_public(request: HttpRequest, incident_id: int, _user=None):
    """Participants/Victims-visible: list hospitals' basic resources for an incident.

    Visibility: Admins OR users who are active participants of the incident OR enrolled victims of the linked crisis.
    Returns a minimal subset for privacy: hospital_user_id, available_beds, and basic hospital user info.
    """
    _ensure_incident_hospital_resources()
    # Admins can always view
    if not _require_admin(_user):
        # Check participant of incident
        part = query("SELECT id FROM incident_participants WHERE incident_id=%s AND user_id=%s AND status='active'", [incident_id, _user['id']])
        if not part:
            # Fallback: if this incident maps to a crisis where user is a victim, allow
            cr = query("SELECT id FROM crises WHERE incident_id=%s", [incident_id])
            if not cr:
                return JsonResponse({'error': 'forbidden'}, status=403)
            vic = query("SELECT id FROM crisis_victims WHERE crisis_id=%s AND user_id=%s", [cr['id'], _user['id']])
            if not vic:
                return JsonResponse({'error': 'forbidden'}, status=403)
    from .utils import paginate
    base = (
        "SELECT r.hospital_user_id, r.available_beds, r.updated_at, "
        "u.full_name AS hospital_name, u.email AS hospital_email, u.avatar_url AS hospital_avatar_url "
        "FROM incident_hospital_resources r LEFT JOIN users u ON u.id=r.hospital_user_id WHERE r.incident_id=%s"
    )
    rows, meta = paginate(request, base, [incident_id], order_fragment=' ORDER BY r.id DESC')
    return JsonResponse({'results': rows, **meta})

# ============================= INCIDENT FIRE TEAM DEPLOYMENTS ==============================

def _ensure_incident_team_deployments():
    # No-op: final schema includes incident_team_deployments.
    return None

def _is_fire_service(user):
    """Return True if the user represents a fire service/department.

    Accepts seeded role variants; normalizes case to avoid strict string mismatches.
    Examples considered valid: 'fire_service', 'fire_department', 'fd'.
    """
    role = str((user or {}).get('role') or '').lower()
    return role in ('fire_service', 'fire_department', 'fd')

def _my_fire_department_id(user_id: int):
    return (query('SELECT id FROM fire_departments WHERE user_id=%s LIMIT 1', [user_id]) or {}).get('id')

@api_view(require_auth=True, methods=['GET'], csrf=False)
def fire_teams_mine(request: HttpRequest, _user=None):
    """List fire teams relevant to the current user.

    - If user is a fire_service owner: return teams in their department (ownership view).
    - If user is a fire staff member: return teams they are a member of (membership view).
    - Admins can pass ?department_id to view a specific department's teams.

    Public-safe projection; returns an empty list if no association is found.
    """
    # Admin override: pick a department explicitly
    if _require_admin(_user):
        dept_id = None
        try:
            dept_id = int(request.GET.get('department_id') or 0) or None
        except Exception:
            dept_id = None
        if not dept_id:
            return JsonResponse({'items': []})
        rows = query(
            "SELECT id,name,status,created_at FROM fire_teams WHERE department_id=%s ORDER BY id DESC",
            [dept_id], many=True
        ) or []
        return JsonResponse({'items': rows, 'department_id': dept_id})

    # Fire service owner path (department user)
    if _is_fire_service(_user):
        dept_id = _my_fire_department_id(_user['id'])
        if not dept_id:
            return JsonResponse({'items': []})
        rows = query(
            "SELECT id,name,status,created_at FROM fire_teams WHERE department_id=%s ORDER BY id DESC",
            [dept_id], many=True
        ) or []
        return JsonResponse({'items': rows, 'department_id': dept_id})

    # Fire staff membership path: return teams that this user belongs to via fire_staff -> fire_team_members
    try:
        staff = query("SELECT id, department_id FROM fire_staff WHERE user_id=%s LIMIT 1", [_user['id']])
    except Exception:
        staff = None
    if not staff:
        return JsonResponse({'items': []})
    rows = query(
        """
        SELECT t.id, t.name, t.status, t.created_at
        FROM fire_teams t
        JOIN fire_team_members m ON m.team_id = t.id
        JOIN fire_staff s ON s.id = m.staff_id
        WHERE s.user_id=%s AND t.department_id = s.department_id
        ORDER BY t.id DESC
        """,
        [_user['id']], many=True
    ) or []
    return JsonResponse({'items': rows, 'department_id': staff.get('department_id')})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def incident_fire_deploy(request: HttpRequest, incident_id: int, _user=None):
    """Deploy one of my fire teams to an incident.

    Body: { team_id: int, note?: string }
    Permissions: fire_service owner of the team (department user) and must have joined the incident.
    Side effect: posts an incident_events note summarizing the deployment.
    """
    if not (_is_fire_service(_user) or _require_admin(_user)):
        return JsonResponse({'error': 'forbidden'}, status=403)
    # Validate incident exists and is not closed/cancelled
    inc = query('SELECT id,status FROM incidents WHERE id=%s', [incident_id])
    if not inc:
        return JsonResponse({'error': 'not_found'}, status=404)
    if inc['status'] in ('closed','cancelled'):
        return JsonResponse({'error': 'not_joinable'}, status=400)
    data = json.loads(request.body or '{}')
    team_id = int(data.get('team_id') or 0)
    note = _limit_str(data.get('note') or None, 1000) if data.get('note') is not None else None
    if not team_id:
        return JsonResponse({'error': 'missing_team_id'}, status=400)
    dept_id = _my_fire_department_id(_user['id']) if not _require_admin(_user) else None
    if not _require_admin(_user):
        if not dept_id:
            return JsonResponse({'error': 'forbidden'}, status=403)
        # Validate team belongs to my department
        team = query('SELECT id,name FROM fire_teams WHERE id=%s AND department_id=%s', [team_id, dept_id])
        if not team:
            return JsonResponse({'error': 'team_not_found'}, status=404)
    else:
        # Admin path: accept any team but capture its department
        trow = query('SELECT id,department_id,name FROM fire_teams WHERE id=%s', [team_id])
        if not trow:
            return JsonResponse({'error': 'team_not_found'}, status=404)
        dept_id = trow['department_id']
    # Require participant membership unless admin
    if not _require_admin(_user) and not _is_incident_participant(_user['id'], incident_id):
        return JsonResponse({'error': 'forbidden'}, status=403)
    _ensure_incident_team_deployments()
    # Prevent duplicate concurrent deployment for the team
    existing_active = query('SELECT id FROM incident_team_deployments WHERE team_id=%s AND status=\'active\' LIMIT 1', [team_id])
    if existing_active:
        return JsonResponse({'error': 'team_busy'}, status=400)
    did = execute(
        'INSERT INTO incident_team_deployments(incident_id,department_id,team_id,deployed_by_user_id,note) VALUES(%s,%s,%s,%s,%s)',
        [incident_id, dept_id, team_id, _user['id'], note]
    )
    # Mark team as deployed (best effort)
    try:
        execute("UPDATE fire_teams SET status='deployed' WHERE id=%s", [team_id])
    except Exception:
        pass
    # Post activity note (best-effort)
    try:
        tname = query('SELECT name FROM fire_teams WHERE id=%s', [team_id]) or {}
        label = tname.get('name') or f'Team #{team_id}'
        msg = f"[Fire Deployment] {label} deployed"
        if note:
            msg += f" — {note}"
        execute('INSERT INTO incident_events(incident_id,user_id,event_type,note) VALUES(%s,%s,\'note\',%s)', [incident_id, _user['id'], msg])
    except Exception:
        pass
    return JsonResponse({'ok': True, 'id': did})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_incident_fire_deployments(request: HttpRequest, incident_id: int, _user=None):
    """List fire team deployments for an incident (public-safe).
    Supports with_users=1 to include deployed-by user fields.
    """
    _ensure_incident_team_deployments()
    from .utils import paginate
    with_users = str(request.GET.get('with_users') or '').lower() in ('1','true','yes')
    if with_users:
        base = (
            "SELECT d.id, d.incident_id, d.department_id, d.team_id, d.deployed_by_user_id, d.note, d.status, d.created_at, "
            "t.name AS team_name, u.full_name AS deployed_by_name, u.email AS deployed_by_email "
            "FROM incident_team_deployments d "
            "LEFT JOIN fire_teams t ON t.id=d.team_id "
            "LEFT JOIN users u ON u.id=d.deployed_by_user_id "
            "WHERE d.incident_id=%s"
        )
    else:
        base = (
            "SELECT d.id, d.incident_id, d.department_id, d.team_id, d.deployed_by_user_id, d.note, d.status, d.created_at, "
            "t.name AS team_name "
            "FROM incident_team_deployments d LEFT JOIN fire_teams t ON t.id=d.team_id WHERE d.incident_id=%s"
        )
    rows, meta = paginate(request, base, [incident_id], order_fragment=' ORDER BY d.id DESC')
    return JsonResponse({'results': rows, **meta})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def incident_fire_deployment_status(request: HttpRequest, incident_id: int, deployment_id: int, _user=None):
    """Update a deployment's status (active -> completed | withdrawn).

    Body: { status: 'completed' | 'withdrawn' }
    Permissions: Admin or department owner or the original deployer.
    Side effects: If no more active deployments for the team, set team.status back to 'available'.
    Logs an incident_events note.
    """
    _ensure_incident_team_deployments()
    dep = query('SELECT * FROM incident_team_deployments WHERE id=%s AND incident_id=%s', [deployment_id, incident_id])
    if not dep:
        return JsonResponse({'error': 'not_found'}, status=404)
    # Authorization: admin or owner of department or deployer
    allowed = False
    if _require_admin(_user):
        allowed = True
    else:
        # department owner
        try:
            owner = query('SELECT user_id FROM fire_departments WHERE id=%s', [dep['department_id']])
            if owner and int(owner.get('user_id')) == int(_user['id']):
                allowed = True
        except Exception:
            pass
        if not allowed and int(dep.get('deployed_by_user_id')) == int(_user['id']):
            allowed = True
    if not allowed:
        return JsonResponse({'error': 'forbidden'}, status=403)
    if dep['status'] != 'active':
        return JsonResponse({'error': 'invalid_transition'}, status=400)
    data = json.loads(request.body or '{}')
    new_status = str(data.get('status') or '').lower()
    if new_status not in ('completed','withdrawn'):
        return JsonResponse({'error': 'invalid_status'}, status=400)
    execute("UPDATE incident_team_deployments SET status=%s WHERE id=%s", [new_status, deployment_id])
    # If team has no other active deployments, mark available
    try:
        active_other = query('SELECT id FROM incident_team_deployments WHERE team_id=%s AND status=\'active\' LIMIT 1', [dep['team_id']])
        if not active_other:
            execute("UPDATE fire_teams SET status='available' WHERE id=%s", [dep['team_id']])
    except Exception:
        pass
    # Activity log
    try:
        tname = query('SELECT name FROM fire_teams WHERE id=%s', [dep['team_id']]) or {}
        label = tname.get('name') or f"Team #{dep['team_id']}"
        msg = f"[Fire Deployment] {label} {new_status}"
        execute('INSERT INTO incident_events(incident_id,user_id,event_type,note) VALUES(%s,%s,\'note\',%s)', [incident_id, _user['id'], msg])
    except Exception:
        pass
    return JsonResponse({'ok': True})

# ============================= DIAGNOSTICS: GEO STATS ==============================

@api_view(require_auth=True, methods=['GET'], csrf=False)
def geo_stats(request: HttpRequest, _user=None):
    """Return geolocation coverage stats across key tables.

    Response shape:
      {
        fire_departments: { total, with_coords, without_coords },
        fire_requests: {
          total, with_coords, without_coords,
          by_status: { pending, assigned, resolved, cancelled, completed? },
          pending_with_candidates, pending_without_candidates
        },
        users: { lastloc_supported: bool, with_last_location, without_last_location }
      }
    """
    def _count(sql: str, params=None) -> int:
        try:
            row = query(f"SELECT COUNT(1) AS c FROM ({sql}) t", params or []) or {'c': 0}
            return int(row.get('c') or 0)
        except Exception:
            return 0

    # Fire departments coverage
    dept_total = _count("SELECT id FROM fire_departments")
    dept_with = _count("SELECT id FROM fire_departments WHERE lat IS NOT NULL AND lng IS NOT NULL")
    dept_without = max(dept_total - dept_with, 0)

    # Fire requests coverage and status breakdown
    fr_total = _count("SELECT id FROM fire_service_requests")
    fr_with = _count("SELECT id FROM fire_service_requests WHERE lat IS NOT NULL AND lng IS NOT NULL")
    fr_without = max(fr_total - fr_with, 0)
    by_status = {}
    for st in ('pending','assigned','resolved','cancelled','completed'):
        by_status[st] = _count("SELECT id FROM fire_service_requests WHERE status=%s", [st])
    # Pending with/without candidates
    pending_with_cand = _count(
        """
        SELECT DISTINCT r.id
        FROM fire_service_requests r
        JOIN fire_request_candidates c ON c.request_id = r.id
        WHERE r.status='pending'
        """
    )
    pending_total = by_status.get('pending', 0)
    pending_without_cand = max(pending_total - pending_with_cand, 0)

    # Users last location availability (guard columns existence)
    users_lastloc_supported = False
    users_with_lastloc = 0
    users_total = _count("SELECT id FROM users")
    try:
        col = query(
            """
            SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='last_lat'
            """
        )
        if col:
            users_lastloc_supported = True
            users_with_lastloc = _count("SELECT id FROM users WHERE last_lat IS NOT NULL AND last_lng IS NOT NULL")
    except Exception:
        users_lastloc_supported = False
        users_with_lastloc = 0
    users_without_lastloc = users_total - users_with_lastloc if users_lastloc_supported else None

    return JsonResponse({
        'fire_departments': {
            'total': dept_total,
            'with_coords': dept_with,
            'without_coords': dept_without,
        },
        'fire_requests': {
            'total': fr_total,
            'with_coords': fr_with,
            'without_coords': fr_without,
            'by_status': by_status,
            'pending_with_candidates': pending_with_cand,
            'pending_without_candidates': pending_without_cand,
        },
        'users': {
            'lastloc_supported': users_lastloc_supported,
            'with_last_location': users_with_lastloc if users_lastloc_supported else None,
            'without_last_location': users_without_lastloc,
            'total': users_total,
        },
        'ok': True,
    })

# ============================= CRISIS MANAGEMENT (Tables) ==============================

def _ensure_crisis_tables():
    # No-op: schema is managed by final_normalized_schema.sql
    return None

def _incident_status_for_crisis(crisis_id: int):
    try:
        row = query("SELECT i.status FROM crises c JOIN incidents i ON i.id=c.incident_id WHERE c.id=%s", [crisis_id])
        return (row or {}).get('status')
    except Exception:
        return None

def _require_crisis_open(crisis_id: int):
    """Return (ok, error_json) where ok is True if crisis' incident is not closed/cancelled.
    Blocks write actions after closure to keep crisis read-only.
    """
    st = _incident_status_for_crisis(crisis_id)
    if st in ('closed','cancelled'):
        return False, JsonResponse({'error':'crisis_closed','status': st}, status=400)
    return True, None


@api_view(require_auth=True, methods=['POST'], csrf=False)
def create_crisis(request: HttpRequest, _user=None):
    """Admin-only: Create a crisis around a new or existing incident.

    Body:
      - title (required)
      - description?
      - incident_type? (default 'general')
      - severity?
      - lat?, lng?
      - radius_km? (admin-defined search radius for potential victims)
    Returns: { crisis_id, incident_id }
    """
    if not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_crisis_tables()
    data = json.loads(request.body or '{}')
    title = _limit_str((data.get('title') or '').strip(), 255)
    if not title:
        return JsonResponse({'error':'missing_title'}, status=400)
    description = data.get('description')
    itype = _limit_str(data.get('incident_type','general'), 50)
    severity = _limit_str(data.get('severity','') or None, 20) if data.get('severity') else None
    lat = data.get('lat'); lng = data.get('lng')
    radius_km = None
    try:
        if data.get('radius_km') is not None:
            radius_km = float(data.get('radius_km'))
    except Exception:
        return JsonResponse({'error':'invalid_radius'}, status=400)
    # Create incident using existing pattern
    incident_id = execute(
        "INSERT INTO incidents(creator_user_id,title,description,incident_type,severity,lat,lng) VALUES(%s,%s,%s,%s,%s,%s,%s)",
        [_user['id'], title, description, itype, severity, lat, lng]
    )
    # Add creator as participant
    try:
        execute("INSERT INTO incident_participants(incident_id,user_id,role_label) VALUES(%s,%s,%s)", [incident_id, _user['id'], 'admin_creator'])
    except Exception:
        pass
    # Create crisis row
    crisis_id = execute(
        "INSERT INTO crises(incident_id,admin_user_id,radius_km) VALUES(%s,%s,%s)",
        [incident_id, _user['id'], radius_km]
    )
    try:
        _notify(_user['id'], 'crisis_created', {'crisis_id': crisis_id, 'incident_id': incident_id})
    except Exception:
        pass
    return JsonResponse({'crisis_id': crisis_id, 'incident_id': incident_id})


@api_view(require_auth=True, methods=['GET'], csrf=False)
def list_crises(request: HttpRequest, _user=None):
    """List crises (admin sees all; others see open/monitoring/mitigated)."""
    _ensure_crisis_tables()
    from .utils import paginate
    where = []
    params = []
    # Non-admins previously only saw open/monitoring/mitigated. If the client asks for `all=1`,
    # broaden visibility to include completed/closed as well (frontend filters tabs client-side).
    include_all = str(request.GET.get('all', '')).lower() in ('1', 'true', 'yes', 'y')
    if not _require_admin(_user) and not include_all:
        where.append("i.status IN ('open','monitoring','mitigated')")
    base = (
        "SELECT c.id AS crisis_id, c.incident_id, c.radius_km, c.created_at, c.updated_at,"
        " i.title, i.status, i.severity, i.incident_type, i.lat, i.lng, i.opened_at, i.updated_at AS incident_updated_at"
        " FROM crises c JOIN incidents i ON i.id=c.incident_id"
    )
    if where:
        base += ' WHERE ' + ' AND '.join(where)
    rows, meta = paginate(request, base, params, order_fragment=' ORDER BY c.id DESC')
    return JsonResponse({'results': rows, **meta})


@api_view(require_auth=True, methods=['GET'], csrf=False)
def get_crisis(request: HttpRequest, crisis_id: int, _user=None):
    _ensure_crisis_tables()
    row = query(
        """
        SELECT c.id AS crisis_id, c.incident_id, c.radius_km, c.created_at, c.updated_at,
               i.title, i.description, i.status, i.severity, i.incident_type, i.lat, i.lng, i.opened_at, i.closed_at
        FROM crises c JOIN incidents i ON i.id=c.incident_id
        WHERE c.id=%s
        """,
        [crisis_id]
    )
    if not row:
        return JsonResponse({'error':'not_found'}, status=404)
    # Summaries: participants, donations, expenses
    parts = query("SELECT COUNT(1) AS c FROM incident_participants WHERE incident_id=%s AND status='active'", [row['incident_id']]) or {'c': 0}
    dons = query("SELECT COALESCE(SUM(amount),0) AS s FROM crisis_donations WHERE crisis_id=%s", [crisis_id]) or {'s': 0}
    exps = query("SELECT COALESCE(SUM(amount),0) AS s FROM crisis_expenses WHERE crisis_id=%s", [crisis_id]) or {'s': 0}
    row['participant_count'] = int(parts.get('c') or 0)
    row['donations_total'] = float(dons.get('s') or 0)
    row['expenses_total'] = float(exps.get('s') or 0)
    row['balance'] = round(row['donations_total'] - row['expenses_total'], 2)
    # Flag: is current user enrolled as a victim for this crisis?
    try:
        cv = query("SELECT status FROM crisis_victims WHERE crisis_id=%s AND user_id=%s ORDER BY id DESC LIMIT 1", [crisis_id, _user['id']])
        row['is_victim'] = bool(cv)
        if cv and 'status' in cv:
            row['victim_status'] = cv.get('status')
    except Exception:
        row['is_victim'] = False
    # Add my participation request status if any
    try:
        pr = query("SELECT status FROM crisis_participation_requests WHERE crisis_id=%s AND user_id=%s ORDER BY id DESC LIMIT 1", [crisis_id, _user['id']])
        if pr: row['my_participation_request_status'] = pr.get('status')
    except Exception:
        pass
    return JsonResponse(row)

@api_view(require_auth=True, methods=['GET'], csrf=False)
def crisis_completed_summary(request: HttpRequest, crisis_id: int, _user=None):
    """Final summary for a crisis. Allowed when the linked incident is closed/cancelled (admins always).

    Returns high-level aggregates and recent logs: victims, inventory requests, donor meetings, hospital bookings, and incident events.
    """
    _ensure_crisis_tables()
    cr = query("SELECT c.id AS crisis_id, c.incident_id, i.status FROM crises c JOIN incidents i ON i.id=c.incident_id WHERE c.id=%s", [crisis_id])
    if not cr:
        return JsonResponse({'error':'not_found'}, status=404)
    if cr.get('status') not in ('closed','cancelled') and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    # Victims
    victims = query("SELECT id,user_id,status,note,created_at FROM crisis_victims WHERE crisis_id=%s ORDER BY id DESC LIMIT 500", [crisis_id], many=True) or []
    # Requests by type
    inv = query("SELECT id,blood_type,quantity_units,status,created_at FROM blood_inventory_requests WHERE crisis_id=%s ORDER BY id DESC LIMIT 500", [crisis_id], many=True) or []
    donor = query("SELECT id,donor_user_id,blood_type,status,created_at FROM blood_donor_meeting_requests WHERE crisis_id=%s ORDER BY id DESC LIMIT 500", [crisis_id], many=True) or []
    hosp = query("SELECT id,hospital_user_id,service_id,status,created_at FROM service_bookings WHERE crisis_id=%s ORDER BY id DESC LIMIT 500", [crisis_id], many=True) or []
    # Incident events
    events = query("SELECT id,event_type,note,created_at FROM incident_events WHERE incident_id=%s ORDER BY id DESC LIMIT 1000", [cr.get('incident_id')], many=True) or []
    return JsonResponse({'crisis_id': crisis_id, 'incident_id': cr.get('incident_id'), 'status': cr.get('status'), 'victims': victims, 'inventory_requests': inv, 'donor_meetings': donor, 'hospital_bookings': hosp, 'incident_events': events})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_invite(request: HttpRequest, crisis_id: int, _user=None):
    """Admin-only: invite an organization user to participate."""
    if not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_crisis_tables()
    c = query("SELECT id,incident_id FROM crises WHERE id=%s", [crisis_id])
    if not c:
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    org_user_id = data.get('org_user_id')
    org_type = _limit_str((data.get('org_type') or '').strip().lower(), 32)
    note = _limit_str(data.get('note') or None, 500) if data.get('note') else None
    if not org_user_id or not org_type:
        return JsonResponse({'error':'missing_fields'}, status=400)
    try:
        iid = execute("INSERT INTO crisis_invitations(crisis_id,org_user_id,org_type,note) VALUES(%s,%s,%s,%s)", [crisis_id, org_user_id, org_type, note])
    except Exception as e:
        return JsonResponse({'error':'invite_failed','detail':str(e)}, status=400)
    try:
        _notify(org_user_id, 'crisis_invite', {'crisis_id': crisis_id, 'by': _user['id'], 'note': note})
    except Exception:
        pass
    return JsonResponse({'id': iid})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_invitation_respond(request: HttpRequest, crisis_id: int, invitation_id: int, _user=None):
    """Org user accepts or declines an invite; auto-join incident on accept."""
    _ensure_crisis_tables()
    inv = query("SELECT * FROM crisis_invitations WHERE id=%s AND crisis_id=%s", [invitation_id, crisis_id])
    if not inv:
        return JsonResponse({'error':'not_found'}, status=404)
    if inv['org_user_id'] != _user['id'] and not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    data = json.loads(request.body or '{}')
    decision = (data.get('status') or '').strip().lower()
    if decision not in ('accepted','declined'):
        return JsonResponse({'error':'invalid_status'}, status=400)
    execute("UPDATE crisis_invitations SET status=%s, responded_at=NOW() WHERE id=%s", [decision, invitation_id])
    if decision == 'accepted':
        # Auto join incident participants
        cr = query("SELECT incident_id FROM crises WHERE id=%s", [crisis_id]) or {}
        inc_id = cr.get('incident_id')
        if inc_id:
            try:
                # Normalize org_type to canonical participant role labels
                raw = (inv.get('org_type') or '').strip().lower()
                role_map = {
                    'fire_department': 'fire_service',
                    'fire_dept': 'fire_service',
                    'bloodbank': 'blood_bank',
                    'org': 'social_org',
                    'ngo': 'social_org',
                    'social_service': 'social_org',
                }
                role_label = role_map.get(raw, raw or 'participant')
                existing = query("SELECT id,status FROM incident_participants WHERE incident_id=%s AND user_id=%s", [inc_id, _user['id']])
                if not existing:
                    execute("INSERT INTO incident_participants(incident_id,user_id,role_label,status) VALUES(%s,%s,%s,'active')", [inc_id, _user['id'], role_label])
                else:
                    execute("UPDATE incident_participants SET status='active', role_label=%s WHERE id=%s", [role_label, existing['id']])
            except Exception:
                pass
    return JsonResponse({'ok': True, 'status': decision})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def crisis_list_invitations(request: HttpRequest, crisis_id: int, _user=None):
    """Admin-only: list invitations for a crisis (latest first)."""
    if not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_crisis_tables()
    cr = query("SELECT id FROM crises WHERE id=%s", [crisis_id])
    if not cr:
        return JsonResponse({'error':'not_found'}, status=404)
    from .utils import paginate
    with_users = str(request.GET.get('with_users') or '').lower() in ('1','true','yes')
    if with_users:
        base = (
            "SELECT ci.id, ci.org_user_id, ci.org_type, ci.status, ci.note, ci.created_at, ci.responded_at, "
            "u.full_name AS org_user_name, u.avatar_url AS org_user_avatar_url, u.email AS org_user_email "
            "FROM crisis_invitations ci LEFT JOIN users u ON u.id = ci.org_user_id WHERE ci.crisis_id=%s"
        )
    else:
        base = "SELECT id, org_user_id, org_type, status, note, created_at, responded_at FROM crisis_invitations WHERE crisis_id=%s"
    order = ' ORDER BY ci.id DESC' if with_users else ' ORDER BY id DESC'
    rows, meta = paginate(request, base, [crisis_id], order_fragment=order)
    return JsonResponse({'results': rows, **meta})

@api_view(require_auth=True, methods=['DELETE'], csrf=False)
def crisis_delete_invitation(request: HttpRequest, crisis_id: int, invitation_id: int, _user=None):
    """Admin-only: delete (cancel) an invitation record.
    This removes the invite regardless of current status.
    """
    if not _require_admin(_user):
        return JsonResponse({'error': 'forbidden'}, status=403)
    _ensure_crisis_tables()
    cr = query("SELECT id FROM crises WHERE id=%s", [crisis_id])
    if not cr:
        return JsonResponse({'error': 'not_found'}, status=404)
    inv = query("SELECT id FROM crisis_invitations WHERE id=%s AND crisis_id=%s", [invitation_id, crisis_id])
    if not inv:
        return JsonResponse({'error': 'not_found'}, status=404)
    execute("DELETE FROM crisis_invitations WHERE id=%s", [invitation_id])
    return JsonResponse({'ok': True, 'deleted': True})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def crisis_my_invitations(request: HttpRequest, _user=None):
    """List crisis invitations for the current (org) user with crisis details."""
    _ensure_crisis_tables()
    from .utils import paginate
    base = (
        "SELECT ci.id, ci.crisis_id, ci.org_type, ci.status, ci.note, ci.created_at, ci.responded_at, "
        " i.title AS crisis_title, i.status AS crisis_status, i.incident_type, i.severity, i.lat, i.lng "
        " FROM crisis_invitations ci JOIN crises c ON c.id=ci.crisis_id JOIN incidents i ON i.id=c.incident_id "
        " WHERE ci.org_user_id=%s"
    )
    rows, meta = paginate(request, base, [_user['id']], order_fragment=' ORDER BY ci.id DESC')
    return JsonResponse({'results': rows, **meta})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_join_self(request: HttpRequest, crisis_id: int, _user=None):
    """Authenticated user joins crisis incident as volunteer/participant."""
    cr = query("SELECT incident_id FROM crises WHERE id=%s", [crisis_id])
    if not cr:
        return JsonResponse({'error':'not_found'}, status=404)
    inc_id = cr['incident_id']
    # Delegate to join_incident logic
    request._body = request.body  # avoid Django consuming body on reparse
    data = json.loads(request.body or '{}')
    role_label = _limit_str(data.get('role_label','volunteer'), 50)
    try:
        existing = query("SELECT id,status FROM incident_participants WHERE incident_id=%s AND user_id=%s", [inc_id, _user['id']])
        if existing:
            if existing['status'] == 'active':
                return JsonResponse({'error':'already_participant'}, status=400)
            execute("UPDATE incident_participants SET status='active', role_label=%s WHERE id=%s", [role_label, existing['id']])
            return JsonResponse({'id': existing['id'], 'rejoined': True})
        pid = execute("INSERT INTO incident_participants(incident_id,user_id,role_label,status) VALUES(%s,%s,%s,'active')", [inc_id, _user['id'], role_label])
        return JsonResponse({'id': pid})
    except Exception as e:
        return JsonResponse({'error':'join_failed','detail':str(e)}, status=400)

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_leave_self(request: HttpRequest, crisis_id: int, _user=None):
    """Authenticated user leaves the crisis: if a participant, deactivate/remove; if a victim, unenroll.
    Returns a summary of actions taken.
    """
    cr = query("SELECT incident_id FROM crises WHERE id=%s", [crisis_id])
    if not cr:
        return JsonResponse({'error':'not_found'}, status=404)
    inc_id = cr['incident_id']
    actions = { 'participant': False, 'victim': False }
    # Deactivate/remove participant row for this incident
    try:
        part = query("SELECT id FROM incident_participants WHERE incident_id=%s AND user_id=%s", [inc_id, _user['id']])
        if part:
            execute("DELETE FROM incident_participants WHERE id=%s", [part['id']])
            actions['participant'] = True
    except Exception:
        pass
    # Remove victim enrollment if exists
    try:
        vic = query("SELECT id FROM crisis_victims WHERE crisis_id=%s AND user_id=%s", [crisis_id, _user['id']])
        if vic:
            execute("DELETE FROM crisis_victims WHERE id=%s", [vic['id']])
            actions['victim'] = True
    except Exception:
        pass
    return JsonResponse({ 'ok': True, **actions })

# ================ Crisis participation requests (approval flow) ==================

def _ensure_crisis_participation_requests():
    # No-op: schema is managed by final_normalized_schema.sql
    return None

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_participation_request(request: HttpRequest, crisis_id: int, _user=None):
    """Any auth user requests to participate in a crisis; goes to admin for approval."""
    # Schema is assumed present from final_normalized_schema.sql
    c = query("SELECT id,incident_id FROM crises WHERE id=%s", [crisis_id])
    if not c:
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    role_label = _limit_str((data.get('role_label') or 'volunteer').strip(), 64)
    note = _limit_str(data.get('note') or None, 255) if data.get('note') else None
    # If already active participant, no need to request
    if query("SELECT id FROM incident_participants WHERE incident_id=%s AND user_id=%s AND status='active'", [c['incident_id'], _user['id']]):
        return JsonResponse({'error':'already_participant'}, status=400)
    # Make idempotent: if a request exists for this (crisis_id, user_id), update it (if pending/rejected) and return existing id
    existing = query(
        "SELECT id, status FROM crisis_participation_requests WHERE crisis_id=%s AND user_id=%s ORDER BY id DESC LIMIT 1",
        [crisis_id, _user['id']]
    )
    if existing:
        # If previously rejected, allow re-request by setting status back to pending and updating details
        s = (existing.get('status') or '').strip().lower()
        if s in ('', 'pending', 'requested', 'new', None):
            try:
                execute("UPDATE crisis_participation_requests SET role_label=%s, note=%s WHERE id=%s", [role_label, note, existing['id']])
            except Exception:
                pass
            return JsonResponse({'id': existing['id'], 'status': s or 'pending', 'duplicate': True})
        if s in ('rejected', 'declined', 'deny', 'denied', 'revoked', 'removed', 'cancelled', 'canceled'):
            try:
                execute("UPDATE crisis_participation_requests SET status='pending', decided_by_user_id=NULL, role_label=%s, note=%s WHERE id=%s", [role_label, note, existing['id']])
            except Exception:
                pass
            return JsonResponse({'id': existing['id'], 'status': 'pending', 'reopened': True})
        # If previously accepted: if not currently an active participant (e.g., removed), allow re-open by setting back to pending
        if s in ('accepted', 'approved'):
            try:
                inc_id = c.get('incident_id')
                active = query("SELECT id FROM incident_participants WHERE incident_id=%s AND user_id=%s AND status='active'", [inc_id, _user['id']]) if inc_id else None
                if not active:
                    execute("UPDATE crisis_participation_requests SET status='pending', role_label=%s, note=%s WHERE id=%s", [role_label, note, existing['id']])
                    return JsonResponse({'id': existing['id'], 'status': 'pending', 'reopened': True})
            except Exception:
                pass
            # Else still active (caught above), report already_approved to callers
            return JsonResponse({'error': 'already_approved'}, status=400)
    # Insert a new request (handle duplicates defensively)
    try:
        rid = execute("INSERT INTO crisis_participation_requests(crisis_id,user_id,role_label,note) VALUES(%s,%s,%s,%s)", [crisis_id, _user['id'], role_label, note])
    except DBIntegrityError:
        # Race or prior row: fetch existing and either reopen or return duplicate
        existing2 = query(
            "SELECT id, status FROM crisis_participation_requests WHERE crisis_id=%s AND user_id=%s ORDER BY id DESC LIMIT 1",
            [crisis_id, _user['id']]
        ) or {}
        try:
            s2 = (existing2.get('status') or '').strip().lower()
            if s2 in ('rejected', 'declined', 'deny', 'denied', 'revoked', 'removed', 'cancelled', 'canceled'):
                execute("UPDATE crisis_participation_requests SET status='pending', decided_by_user_id=NULL, role_label=%s, note=%s WHERE id=%s", [role_label, note, existing2['id']])
                return JsonResponse({'id': existing2.get('id'), 'status': 'pending', 'reopened': True})
        except Exception:
            pass
        return JsonResponse({'id': existing2.get('id'), 'status': (existing2.get('status') or 'pending'), 'duplicate': True})
    try:
        _notify(_user['id'], 'participation_requested', {'crisis_id': crisis_id, 'request_id': rid})
    except Exception:
        pass
    return JsonResponse({'id': rid, 'status': 'pending'})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def crisis_participation_requests_list(request: HttpRequest, crisis_id: int, _user=None):
    """Admin-only: list participation requests for a crisis."""
    if not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    # Schema is assumed present from final_normalized_schema.sql
    from .utils import paginate
    status_filter = (request.GET.get('status') or '').strip().lower()
    with_users = True  # always join users for admin view
    where = "WHERE r.crisis_id=%s"
    params = [crisis_id]
    if status_filter in ('pending', 'requested', 'new', 'open'):
        where += " AND (r.status IS NULL OR LOWER(r.status) IN ('pending','requested','request','new'))"
    elif status_filter in ('accepted','approved'):
        where += " AND LOWER(r.status) IN ('accepted','approved')"
    elif status_filter in ('rejected','declined','deny','denied'):
        where += " AND LOWER(r.status) IN ('rejected','declined','deny','denied')"
    elif status_filter in ('revoked','removed','cancelled','canceled'):
        where += " AND LOWER(r.status) IN ('revoked','removed','cancelled','canceled')"
    # else: no extra filter -> return all
    base = (
        "SELECT r.*, u.full_name AS user_name, u.email AS user_email, u.avatar_url AS user_avatar_url "
        f"FROM crisis_participation_requests r JOIN users u ON u.id=r.user_id {where}"
    )
    rows, meta = paginate(request, base, params, order_fragment=' ORDER BY r.id DESC')
    return JsonResponse({'results': rows, **meta})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_participation_request_decide(request: HttpRequest, crisis_id: int, request_id: int, _user=None):
    """Admin: accept or reject a participation request; on accept, add to incident_participants."""
    if not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    # Schema is assumed present from final_normalized_schema.sql
    r = query("SELECT * FROM crisis_participation_requests WHERE id=%s AND crisis_id=%s", [request_id, crisis_id])
    if not r:
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    decision = (data.get('status') or '').strip().lower()
    # Accept common synonyms from clients
    if decision in ('approve', 'approved', 'accept'):
        decision = 'accepted'
    if decision in ('reject', 'decline', 'declined', 'deny', 'denied'):
        decision = 'rejected'
    if decision not in ('accepted','rejected'):
        return JsonResponse({'error':'invalid_status'}, status=400)
    execute("UPDATE crisis_participation_requests SET status=%s, decided_by_user_id=%s WHERE id=%s", [decision, _user['id'], request_id])
    # Ensure only one latest accepted request remains marked as accepted and clear others from pending
    if decision == 'accepted':
        try:
            execute("UPDATE crisis_participation_requests SET status='rejected' WHERE crisis_id=%s AND user_id=%s AND status IN ('pending','requested','new') AND id<>%s", [crisis_id, r['user_id'], request_id])
        except Exception:
            pass
    if decision == 'accepted':
        cr = query("SELECT incident_id FROM crises WHERE id=%s", [crisis_id]) or {}
        inc_id = cr.get('incident_id')
        if inc_id:
            try:
                ex = query("SELECT id FROM incident_participants WHERE incident_id=%s AND user_id=%s", [inc_id, r['user_id']])
                if not ex:
                    # Ensure newly added participant is marked active explicitly
                    execute("INSERT INTO incident_participants(incident_id,user_id,role_label,status) VALUES(%s,%s,%s,'active')", [inc_id, r['user_id'], r.get('role_label') or 'participant'])
                else:
                    execute("UPDATE incident_participants SET status='active', role_label=%s WHERE id=%s", [r.get('role_label') or 'participant', ex['id']])
            except Exception:
                pass
    return JsonResponse({'ok': True, 'status': decision})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def crisis_participation_mine(request: HttpRequest, crisis_id: int, _user=None):
    """Current user's participation request status for this crisis."""
    # Schema is assumed present from final_normalized_schema.sql
    row = query("SELECT id,status,role_label,note,created_at,updated_at FROM crisis_participation_requests WHERE crisis_id=%s AND user_id=%s ORDER BY id DESC LIMIT 1", [crisis_id, _user['id']]) or {}
    return JsonResponse(row)

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_add_donation(request: HttpRequest, crisis_id: int, _user=None):
    _ensure_crisis_tables()
    data = json.loads(request.body or '{}')
    try:
        amount = float(data.get('amount'))
    except Exception:
        return JsonResponse({'error':'invalid_amount'}, status=400)
    note = _limit_str(data.get('note') or None, 255) if data.get('note') else None
    did = execute("INSERT INTO crisis_donations(crisis_id,user_id,amount,note) VALUES(%s,%s,%s,%s)", [crisis_id, _user['id'], amount, note])
    try:
        _notify(_user['id'], 'crisis_donation', {'crisis_id': crisis_id, 'donation_id': did, 'amount': amount})
    except Exception:
        pass
    return JsonResponse({'id': did})

@api_view(methods=['GET'], csrf=False)
def crisis_list_donations(request: HttpRequest, crisis_id: int, _user=None):
    _ensure_crisis_tables()
    from .utils import paginate
    base = "SELECT id,user_id,amount,note,created_at FROM crisis_donations WHERE crisis_id=%s"
    rows, meta = paginate(request, base, [crisis_id], order_fragment=' ORDER BY id DESC')
    return JsonResponse({'results': rows, **meta})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_add_expense(request: HttpRequest, crisis_id: int, _user=None):
    if not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_crisis_tables()
    data = json.loads(request.body or '{}')
    try:
        amount = float(data.get('amount'))
    except Exception:
        return JsonResponse({'error':'invalid_amount'}, status=400)
    purpose = _limit_str(data.get('purpose') or None, 255) if data.get('purpose') else None
    eid = execute("INSERT INTO crisis_expenses(crisis_id,user_id,amount,purpose) VALUES(%s,%s,%s,%s)", [crisis_id, _user['id'], amount, purpose])
    return JsonResponse({'id': eid})

@api_view(methods=['GET'], csrf=False)
def crisis_list_expenses(request: HttpRequest, crisis_id: int, _user=None):
    _ensure_crisis_tables()
    from .utils import paginate
    base = "SELECT id,user_id,amount,purpose,created_at FROM crisis_expenses WHERE crisis_id=%s"
    rows, meta = paginate(request, base, [crisis_id], order_fragment=' ORDER BY id DESC')
    return JsonResponse({'results': rows, **meta})

@api_view(methods=['GET'], csrf=False)
def crisis_finance_summary(request: HttpRequest, crisis_id: int, _user=None):
    _ensure_crisis_tables()
    dons = query("SELECT COALESCE(SUM(amount),0) AS s FROM crisis_donations WHERE crisis_id=%s", [crisis_id]) or {'s': 0}
    exps = query("SELECT COALESCE(SUM(amount),0) AS s FROM crisis_expenses WHERE crisis_id=%s", [crisis_id]) or {'s': 0}
    total_don = float(dons.get('s') or 0)
    total_exp = float(exps.get('s') or 0)
    return JsonResponse({'donations_total': total_don, 'expenses_total': total_exp, 'balance': round(total_don - total_exp, 2)})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_victims_enroll(request: HttpRequest, crisis_id: int, _user=None):
    _ensure_crisis_tables()
    data = json.loads(request.body or '{}')
    note = _limit_str(data.get('note') or None, 255) if data.get('note') else None
    # Uniqueness is enforced by final schema on (crisis_id, user_id).
    # Idempotent behavior: return existing record if present; update note if provided
    existing = None
    try:
        existing = query("SELECT id,status,note FROM crisis_victims WHERE crisis_id=%s AND user_id=%s", [crisis_id, _user['id']])
    except Exception:
        existing = None
    if existing:
        try:
            if note and note != existing.get('note'):
                execute("UPDATE crisis_victims SET note=%s WHERE id=%s", [note, existing['id']])
        except Exception:
            pass
        return JsonResponse({'id': existing['id'], 'status': existing.get('status'), 'already': True})
    # Insert new enrollment row
    try:
        vid = execute("INSERT INTO crisis_victims(crisis_id,user_id,note) VALUES(%s,%s,%s)", [crisis_id, _user['id'], note])
        return JsonResponse({'id': vid})
    except Exception as e:
        # If a race occurred and DB prevented duplicate, fetch and return existing
        try:
            existing2 = query("SELECT id,status FROM crisis_victims WHERE crisis_id=%s AND user_id=%s", [crisis_id, _user['id']])
            if existing2:
                return JsonResponse({'id': existing2['id'], 'status': existing2.get('status'), 'already': True})
        except Exception:
            pass
        return JsonResponse({'error':'enroll_failed','detail':str(e)}, status=400)

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_victim_status(request: HttpRequest, crisis_id: int, victim_id: int, _user=None):
    # Allow admins or active incident participants to update victim status.
    # Restrict 'dismissed' action to admins only.
    _ensure_crisis_tables()
    # Load crisis -> incident mapping
    cr = query("SELECT incident_id FROM crises WHERE id=%s", [crisis_id])
    if not cr:
        return JsonResponse({'error':'not_found'}, status=404)
    is_admin = _require_admin(_user)
    is_participant = False
    try:
        part = query("SELECT id FROM incident_participants WHERE incident_id=%s AND user_id=%s AND status='active'", [cr['incident_id'], _user['id']])
        is_participant = bool(part)
    except Exception:
        is_participant = False
    if not (is_admin or is_participant):
        return JsonResponse({'error':'forbidden'}, status=403)
    cv = query("SELECT * FROM crisis_victims WHERE id=%s AND crisis_id=%s", [victim_id, crisis_id])
    if not cv:
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    st = (data.get('status') or '').strip().lower()
    if st not in ('pending','confirmed','dismissed'):
        return JsonResponse({'error':'invalid_status'}, status=400)
    # Only admins can dismiss; participants can set pending/confirmed
    if st == 'dismissed' and not is_admin:
        return JsonResponse({'error':'forbidden'}, status=403)
    execute("UPDATE crisis_victims SET status=%s WHERE id=%s", [st, victim_id])
    return JsonResponse({'ok': True, 'status': st})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_victim_admin_create(request: HttpRequest, crisis_id: int, _user=None):
    """Admin: create a victim enrollment on behalf of a user.

    Body: { user_id?, email?, note? }
    - If email is provided, it will be looked up to resolve user_id.
    - Idempotent: returns existing row if already enrolled.
    """
    if not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_crisis_tables()
    data = json.loads(request.body or '{}')
    target_user_id = int(data.get('user_id') or 0)
    email = (data.get('email') or '').strip().lower()
    note = _limit_str(data.get('note') or None, 255) if data.get('note') else None
    if not target_user_id and not email:
        return JsonResponse({'error':'missing_user'}, status=400)
    if not target_user_id and email:
        u = query("SELECT id FROM users WHERE email=%s", [email])
        if not u:
            return JsonResponse({'error':'user_not_found'}, status=404)
        target_user_id = int(u['id'])
    # Uniqueness is enforced by final schema.
    ex = query("SELECT id,status,note FROM crisis_victims WHERE crisis_id=%s AND user_id=%s", [crisis_id, target_user_id])
    if ex:
        if note and note != ex.get('note'):
            try:
                execute("UPDATE crisis_victims SET note=%s WHERE id=%s", [note, ex['id']])
            except Exception:
                pass
        return JsonResponse({'id': ex['id'], 'status': ex.get('status'), 'already': True})
    vid = execute("INSERT INTO crisis_victims(crisis_id,user_id,note) VALUES(%s,%s,%s)", [crisis_id, target_user_id, note])
    return JsonResponse({'id': vid})

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_victims_unenroll(request: HttpRequest, crisis_id: int, _user=None):
    """Self-remove a victim enrollment from a crisis."""
    _ensure_crisis_tables()
    vic = query("SELECT id FROM crisis_victims WHERE crisis_id=%s AND user_id=%s", [crisis_id, _user['id']])
    if not vic:
        return JsonResponse({'error':'not_found'}, status=404)
    execute("DELETE FROM crisis_victims WHERE id=%s", [vic['id']])
    return JsonResponse({'ok': True, 'deleted': True})

@api_view(require_auth=True, methods=['GET', 'PUT', 'DELETE'], csrf=False)
def crisis_victim_item(request: HttpRequest, crisis_id: int, victim_id: int, _user=None):
    """Admin: read/update/delete a single crisis_victims row.

    PUT Body: { status?, note? }
    """
    if not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_crisis_tables()
    cv = query("SELECT * FROM crisis_victims WHERE id=%s AND crisis_id=%s", [victim_id, crisis_id])
    if not cv:
        return JsonResponse({'error':'not_found'}, status=404)
    if request.method == 'GET':
        return JsonResponse(cv)
    if request.method == 'PUT':
        data = json.loads(request.body or '{}')
        fields = {}
        if 'status' in data:
            st = (data.get('status') or '').strip().lower()
            if st not in ('pending','confirmed','dismissed'):
                return JsonResponse({'error':'invalid_status'}, status=400)
            fields['status'] = st
        if 'note' in data:
            fields['note'] = _limit_str(data.get('note') or None, 255)
        if not fields:
            return JsonResponse({'error':'nothing_to_update'}, status=400)
        sets = []
        args = []
        for k,v in fields.items():
            sets.append(f"{k}=%s")
            args.append(v)
        args.extend([victim_id])
        execute("UPDATE crisis_victims SET " + ",".join(sets) + " WHERE id=%s", args)
        row = query("SELECT * FROM crisis_victims WHERE id=%s", [victim_id])
        return JsonResponse(row)
    if request.method == 'DELETE':
        execute("DELETE FROM crisis_victims WHERE id=%s AND crisis_id=%s", [victim_id, crisis_id])
        return JsonResponse({'ok': True})
    return JsonResponse({'error':'method_not_allowed'}, status=405)

@api_view(require_auth=True, methods=['POST'], csrf=False)
def crisis_victim_admin_set_location(request: HttpRequest, crisis_id: int, victim_id: int, _user=None):
    """Admin: set a victim user's location (writes users.last_lat/last_lng + user_locations).

    Body: { lat: number, lng: number, source?: string }
    """
    if not _require_admin(_user):
        return JsonResponse({'error':'forbidden'}, status=403)
    _ensure_crisis_tables()
    cv = query("SELECT user_id FROM crisis_victims WHERE id=%s AND crisis_id=%s", [victim_id, crisis_id])
    if not cv:
        return JsonResponse({'error':'not_found'}, status=404)
    data = json.loads(request.body or '{}')
    try:
        lat = float(data.get('lat'))
        lng = float(data.get('lng'))
    except Exception:
        return JsonResponse({'error':'invalid_coordinates'}, status=400)
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return JsonResponse({'error':'out_of_range'}, status=400)
    source = data.get('source') or 'admin'
    try:
        execute("UPDATE users SET last_lat=%s, last_lng=%s WHERE id=%s", [lat, lng, int(cv['user_id'])])
    except Exception:
        pass
    try:
        execute("INSERT INTO user_locations(user_id,lat,lng,source) VALUES(%s,%s,%s,%s)", [int(cv['user_id']), lat, lng, source])
    except Exception as e:
        return JsonResponse({'error':'persist_failed','detail':str(e)}, status=500)
    return JsonResponse({'ok': True})

@api_view(methods=['GET'], csrf=False)
def crisis_victims_list(request: HttpRequest, crisis_id: int, _user=None):
    _ensure_crisis_tables()
    from .utils import paginate
    with_users = str(request.GET.get('with_users') or '').lower() in ('1','true','yes')
    # Prefer including the latest known location (lat/lng) for each victim.
    # If the geo table is unavailable, gracefully fall back to a query that never references missing columns.
    params = []

    # Detect if users.last_lat/last_lng columns exist; avoid referencing them if absent
    users_lastloc_supported = False
    try:
        col = query(
            """
            SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='last_lat'
            """
        )
        if col:
            users_lastloc_supported = True
    except Exception:
        users_lastloc_supported = False

    # Common FROM for latest victim row per user within the crisis
    from_cv = (
        "FROM ("
        "  SELECT cv2.* FROM crisis_victims cv2 "
        "  JOIN (SELECT user_id, MAX(id) AS max_id FROM crisis_victims WHERE crisis_id=%s GROUP BY user_id) mx "
        "    ON mx.max_id = cv2.id "
        "  WHERE cv2.crisis_id=%s"
        ") cv "
    )
    join_users = "LEFT JOIN users u ON u.id = cv.user_id "
    join_loc = (
        "LEFT JOIN ("
        "  SELECT ul1.user_id, ul1.lat AS last_lat, ul1.lng AS last_lng, ul1.captured_at AS last_loc_time "
        "  FROM user_locations ul1 "
        "  JOIN (SELECT user_id, MAX(captured_at) AS max_cap FROM user_locations GROUP BY user_id) m "
        "    ON m.user_id = ul1.user_id AND m.max_cap = ul1.captured_at"
        ") loc ON loc.user_id = cv.user_id"
    )

    # Build SELECT parts depending on flags
    if with_users:
        user_fields = "u.full_name AS user_name, u.avatar_url, u.email, "
    else:
        user_fields = ""

    # Always avoid referencing users.last_lat/last_lng in the base SELECT to keep COUNT(*) safe.
    # Provide NULL placeholders to preserve response shape.
    loc_fields_with = "loc.last_lat AS lat, loc.last_lng AS lng, loc.last_loc_time, NULL AS user_last_lat, NULL AS user_last_lng "
    loc_fields_no = "NULL AS lat, NULL AS lng, NULL AS last_loc_time, NULL AS user_last_lat, NULL AS user_last_lng "

    # Compose base queries
    base_with_loc = (
        "SELECT cv.id, cv.user_id, cv.status, cv.note, cv.created_at, "
        f"{user_fields}"
        f"{loc_fields_with}"
        f"{from_cv}"
        f"{join_users}"
        f"{join_loc}"
    )

    base_no_loc = (
        "SELECT cv.id, cv.user_id, cv.status, cv.note, cv.created_at, "
        f"{user_fields}"
        f"{loc_fields_no}"
        f"{from_cv}"
        f"{join_users}"
    )
    params = [crisis_id, crisis_id]
    # Qualify ORDER BY to avoid ambiguity when joining users
    order_by = ' ORDER BY cv.id DESC' if with_users else ' ORDER BY cv.id DESC'
    try:
        rows, meta = paginate(request, base_with_loc, params, order_fragment=order_by)
    except Exception:
        # Fallback without location join; ensure it never references non-existent columns
        fb_order = ' ORDER BY cv.id DESC'
        rows, meta = paginate(request, base_no_loc, params, order_fragment=fb_order)
    return JsonResponse({'results': rows, **meta})

@api_view(methods=['GET'], csrf=False)
def crisis_potential_victims(request: HttpRequest, crisis_id: int, _user=None):
    """List users whose last known location is within crisis radius_km of the crisis lat/lng.

    If crisis has no lat/lng, returns empty. If radius_km is null, default 5km.
    """
    _ensure_crisis_tables()
    cr = query("SELECT c.radius_km, i.lat, i.lng FROM crises c JOIN incidents i ON i.id=c.incident_id WHERE c.id=%s", [crisis_id])
    if not cr:
        return JsonResponse({'results': []})
    lat = cr.get('lat'); lng = cr.get('lng')
    if lat is None or lng is None:
        return JsonResponse({'results': []})
    try:
        radius_km = float(cr.get('radius_km') or 5.0)
    except Exception:
        radius_km = 5.0
    # Build bounding box then Haversine filter (reuse nearby_users logic)
    import math
    lat = float(lat); lng = float(lng)
    lat_delta = radius_km / 111.0
    lng_delta = radius_km / (111.0 * max(math.cos(math.radians(lat)), 0.0001))
    min_lat, max_lat = lat - lat_delta, lat + lat_delta
    min_lng, max_lng = lng - lng_delta, lng + lng_delta
    with_users = str(request.GET.get('with_users') or '').lower() in ('1','true','yes')
    # Use latest location per user from user_locations table for portability
    try:
        if with_users:
            rows = query(
                """
                SELECT ul.user_id, ul.lat, ul.lng, u.full_name AS user_name, u.avatar_url, u.email
                FROM user_locations ul
                JOIN users u ON u.id = ul.user_id
                WHERE u.role IN ('regular','admin')
                  AND ul.id = (
                      SELECT ul2.id
                      FROM user_locations ul2
                      WHERE ul2.user_id = ul.user_id
                      ORDER BY ul2.captured_at DESC, ul2.id DESC
                      LIMIT 1
                  )
                  AND ul.lat BETWEEN %s AND %s
                  AND ul.lng BETWEEN %s AND %s
                LIMIT 1000
                """,
                [min_lat, max_lat, min_lng, max_lng], many=True
            ) or []
        else:
            rows = query(
                """
                SELECT ul.user_id, ul.lat, ul.lng
                FROM user_locations ul
                JOIN users u ON u.id = ul.user_id
                WHERE u.role IN ('regular','admin')
                  AND ul.id = (
                      SELECT ul2.id
                      FROM user_locations ul2
                      WHERE ul2.user_id = ul.user_id
                      ORDER BY ul2.captured_at DESC, ul2.id DESC
                      LIMIT 1
                  )
                  AND ul.lat BETWEEN %s AND %s
                  AND ul.lng BETWEEN %s AND %s
                LIMIT 1000
                """,
                [min_lat, max_lat, min_lng, max_lng], many=True
            ) or []
    except Exception:
        # If geo table missing or query fails, degrade gracefully
        rows = []
    def hav(a_lat, a_lng, b_lat, b_lng):
        R = 6371.0
        dlat = math.radians(b_lat - a_lat)
        dlng = math.radians(b_lng - a_lng)
        alat = math.radians(a_lat); blat = math.radians(b_lat)
        h = math.sin(dlat/2)**2 + math.cos(alat)*math.cos(blat)*math.sin(dlng/2)**2
        return 2 * R * math.asin(math.sqrt(h))
    results = []
    for r in rows:
        d = hav(lat, lng, float(r['lat']), float(r['lng']))
        if d <= radius_km + 1e-6:
            item = {'user_id': r['user_id'], 'lat': float(r['lat']), 'lng': float(r['lng']), 'distance_km': round(d, 2)}
            if with_users:
                if 'user_name' in r: item['user_name'] = r.get('user_name')
                if 'avatar_url' in r: item['avatar_url'] = r.get('avatar_url')
                if 'email' in r: item['email'] = r.get('email')
            results.append(item)
    results.sort(key=lambda x: x['distance_km'])
    return JsonResponse({'results': results[:200]})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def crises_nearby(request: HttpRequest, _user=None):
    """Return active crises near a coordinate within radius_km (default 25km, max 200km).

    Accepts optional query params: lat, lng, radius_km. If lat/lng are omitted, uses
    the authenticated user's latest location from user_locations. Returns crises joined to
    incidents with coordinates and status in ('open','monitoring').

    Response: { results: [ { crisis_id, incident_id, title, status, severity, lat, lng, distance_km } ] }
    """
    _ensure_crisis_tables()
    # Read params or derive from user_locations
    lat = None; lng = None
    try:
        if request.GET.get('lat') and request.GET.get('lng'):
            lat = float(request.GET.get('lat'))
            lng = float(request.GET.get('lng'))
    except Exception:
        lat = None; lng = None
    if lat is None or lng is None:
        try:
            loc = query(
                "SELECT lat,lng FROM user_locations WHERE user_id=%s ORDER BY captured_at DESC LIMIT 1",
                [_user['id']]
            )
            if loc:
                lat = float(loc.get('lat'))
                lng = float(loc.get('lng'))
        except Exception:
            lat = None; lng = None
    try:
        radius_km = float(request.GET.get('radius_km') or 25.0)
    except Exception:
        radius_km = 25.0
    radius_km = max(0.1, min(radius_km, 200.0))
    if lat is None or lng is None:
        # Without coordinates we cannot compute distance; return empty with a hint
        return JsonResponse({'results': [], 'hint': 'no_location'})
    # Bounding box approximation
    import math
    lat_delta = radius_km / 111.0
    lng_delta = radius_km / (111.0 * max(math.cos(math.radians(lat)), 0.0001))
    min_lat, max_lat = lat - lat_delta, lat + lat_delta
    min_lng, max_lng = lng - lng_delta, lng + lng_delta
    # Query candidate crises with incidents in bbox and active statuses
    rows = query(
        """
        SELECT c.id AS crisis_id, c.incident_id, COALESCE(c.radius_km, 5.0) AS radius_km,
               i.title, i.status, i.severity, i.lat, i.lng, i.incident_type
        FROM crises c
        JOIN incidents i ON i.id=c.incident_id
        WHERE i.lat BETWEEN %s AND %s AND i.lng BETWEEN %s AND %s
          AND i.status IN ('open','monitoring')
        LIMIT 1000
        """,
        [min_lat, max_lat, min_lng, max_lng], many=True
    ) or []
    # Haversine precise filter and sorting
    def hav(a_lat, a_lng, b_lat, b_lng):
        R = 6371.0
        dlat = math.radians(b_lat - a_lat)
        dlng = math.radians(b_lng - a_lng)
        alat = math.radians(a_lat); blat = math.radians(b_lat)
        h = math.sin(dlat/2)**2 + math.cos(alat)*math.cos(blat)*math.sin(dlng/2)**2
        return 2 * R * math.asin(math.sqrt(h))
    out = []
    for r in rows:
        try:
            d = hav(lat, lng, float(r['lat']), float(r['lng']))
        except Exception:
            continue
        if d <= radius_km + 1e-6:
            out.append({
                'crisis_id': int(r['crisis_id']),
                'incident_id': int(r['incident_id']),
                'title': r.get('title'),
                'status': r.get('status'),
                'severity': r.get('severity'),
                'lat': float(r['lat']),
                'lng': float(r['lng']),
                'distance_km': round(d, 2),
            })
    out.sort(key=lambda x: x['distance_km'])
    return JsonResponse({'results': out[:50]})

@api_view(require_auth=True, methods=['GET'], csrf=False)
def crisis_requests_all(request: HttpRequest, crisis_id: int, _user=None):
    """Unified crisis-scoped requests feed visible to all authenticated users.

    Returns the latest crisis-scoped requests across types (blood inventory, donor meetings, hospital bookings,
    and nearby fire service requests when the crisis has a defined location).

    Query params: page, page_size.
    Output shape: { results: [ { type: 'inventory'|'donor'|'hospital'|'fire', id, created_at, status, requester_id, requester_name, ... } ], ... }
    """
    # Ensure crisis exists (avoid leaking data for arbitrary ids)
    _ensure_crisis_tables()
    # Some environments may not have lat/lng/radius_km on crises; probe defensively
    try:
        cr = query("SELECT id, lat, lng, radius_km FROM crises WHERE id=%s", [crisis_id])
    except Exception:
        cr = query("SELECT id FROM crises WHERE id=%s", [crisis_id])
    if not cr:
        return JsonResponse({'results': [], 'page': 1, 'page_size': 20, 'total': 0, 'total_pages': 1, 'has_next': False, 'has_prev': False})
    # Visibility: admins, incident participants, and enrolled victims of the crisis
    if not _require_admin(_user):
        try:
            # Check participant membership
            part = query("SELECT ip.id FROM crises c JOIN incident_participants ip ON ip.incident_id=c.incident_id AND ip.user_id=%s AND ip.status='active' WHERE c.id=%s", [_user['id'], crisis_id])
            if not part:
                # Check enrolled as a victim
                vic = query("SELECT id FROM crisis_victims WHERE crisis_id=%s AND user_id=%s", [crisis_id, _user['id']])
                if not vic:
                    return JsonResponse({'error':'forbidden'}, status=403)
        except Exception:
            # If tables missing or any error, deny by default for safety
            return JsonResponse({'error':'forbidden'}, status=403)
    from .utils import paginate
    # Build an aggregated SELECT using UNION ALL with normalized columns
    selects = []
    params = []
    # Blood inventory requests (scoped by crisis_id)
    selects.append(
        "  SELECT 'inventory' AS rtype, rir.id AS rid, rir.created_at, rir.status,"
        "         rir.requester_user_id AS requester_id, u.full_name AS requester_name,"
        "         rir.bank_user_id, NULL AS donor_user_id, NULL AS assigned_department_id, NULL AS assigned_department_name,"
        "         rir.blood_type, rir.quantity_units,"
        "         rir.target_datetime, rir.location_text "
        "    FROM blood_inventory_requests rir JOIN users u ON u.id=rir.requester_user_id"
        "    WHERE rir.crisis_id=%s"
    )
    params.append(crisis_id)
    # Donor meeting requests (scoped by crisis_id)
    selects.append(
        "  SELECT 'donor' AS rtype, rdm.id AS rid, rdm.created_at, rdm.status,"
        "         rdm.requester_user_id AS requester_id, u2.full_name AS requester_name,"
        "         NULL AS bank_user_id, rdm.donor_user_id, NULL AS assigned_department_id, NULL AS assigned_department_name,"
        "         rdm.blood_type, NULL AS quantity_units,"
        "         rdm.target_datetime, rdm.location_text "
        "    FROM blood_donor_meeting_requests rdm JOIN users u2 ON u2.id=rdm.requester_user_id"
        "    WHERE rdm.crisis_id=%s"
    )
    params.append(crisis_id)
    # Hospital service bookings (scoped by crisis_id)
    selects.append(
        "  SELECT 'hospital' AS rtype, sb.id AS rid, sb.created_at, sb.status,"
        "         sb.user_id AS requester_id, u3.full_name AS requester_name,"
        "         sb.hospital_user_id AS bank_user_id, NULL AS donor_user_id, NULL AS assigned_department_id, NULL AS assigned_department_name,"
        "         NULL AS blood_type, NULL AS quantity_units,"
        "         sb.scheduled_at AS target_datetime, sb.approx_time AS location_text "
        "    FROM service_bookings sb JOIN users u3 ON u3.id=sb.user_id"
        "    WHERE sb.crisis_id=%s"
    )
    params.append(crisis_id)
    # Fire service requests
    try:
        lat = cr.get('lat') if isinstance(cr, dict) else None
        lng = cr.get('lng') if isinstance(cr, dict) else None
        radius_km = cr.get('radius_km') if isinstance(cr, dict) else None
        if lat is not None and lng is not None and radius_km is not None:
            # 1) Include requests within the crisis bounding box
            try:
                import math
                box_delta = float(radius_km) / 111.0
                min_lat = float(lat) - box_delta
                max_lat = float(lat) + box_delta
                lng_delta = box_delta / max(math.cos(math.radians(float(lat))), 0.0001)
                min_lng = float(lng) - lng_delta
                max_lng = float(lng) + lng_delta
                selects.append(
                    "  SELECT 'fire' AS rtype, fsr.id AS rid, fsr.created_at, fsr.status,"
                    "         fsr.requester_id AS requester_id, u4.full_name AS requester_name,"
                    "         NULL AS bank_user_id, NULL AS donor_user_id, fsr.assigned_department_id AS assigned_department_id, fd.name AS assigned_department_name,"
                    "         NULL AS blood_type, NULL AS quantity_units,"
                    "         NULL AS target_datetime, fsr.description AS location_text "
                    "    FROM fire_service_requests fsr JOIN users u4 ON u4.id=fsr.requester_id "
                    "    LEFT JOIN fire_departments fd ON fd.id=fsr.assigned_department_id "
                    "    WHERE fsr.lat BETWEEN %s AND %s AND fsr.lng BETWEEN %s AND %s"
                )
                params.extend([min_lat, max_lat, min_lng, max_lng])
                # 2) Also include requests created by enrolled victims of this crisis that are outside the bbox or lack coords
                selects.append(
                    "  SELECT 'fire' AS rtype, fsr.id AS rid, fsr.created_at, fsr.status,"
                    "         fsr.requester_id AS requester_id, u5.full_name AS requester_name,"
                    "         NULL AS bank_user_id, NULL AS donor_user_id, fsr.assigned_department_id AS assigned_department_id, fd2.name AS assigned_department_name,"
                    "         NULL AS blood_type, NULL AS quantity_units,"
                    "         NULL AS target_datetime, fsr.description AS location_text "
                    "    FROM fire_service_requests fsr JOIN crisis_victims cv ON cv.crisis_id=%s AND cv.user_id=fsr.requester_id "
                    "    JOIN users u5 ON u5.id=fsr.requester_id "
                    "    LEFT JOIN fire_departments fd2 ON fd2.id=fsr.assigned_department_id "
                    "    WHERE (fsr.lat IS NULL OR fsr.lng IS NULL OR NOT (fsr.lat BETWEEN %s AND %s AND fsr.lng BETWEEN %s AND %s))"
                )
                params.extend([crisis_id, min_lat, max_lat, min_lng, max_lng])
            except Exception:
                pass
        else:
            # Crisis lacks coords; include fire requests authored by enrolled victims
            selects.append(
                "  SELECT 'fire' AS rtype, fsr.id AS rid, fsr.created_at, fsr.status,"
                "         fsr.requester_id AS requester_id, u6.full_name AS requester_name,"
                "         NULL AS bank_user_id, NULL AS donor_user_id, fsr.assigned_department_id AS assigned_department_id, fd3.name AS assigned_department_name,"
                "         NULL AS blood_type, NULL AS quantity_units,"
                "         NULL AS target_datetime, fsr.description AS location_text "
                "    FROM fire_service_requests fsr JOIN crisis_victims cv ON cv.crisis_id=%s AND cv.user_id=fsr.requester_id "
                "    JOIN users u6 ON u6.id=fsr.requester_id "
                "    LEFT JOIN fire_departments fd3 ON fd3.id=fsr.assigned_department_id"
            )
            params.append(crisis_id)
    except Exception:
        pass
    base = "SELECT * FROM (\n" + ("\n  UNION ALL\n".join(selects)) + "\n) agg"
    # Order newest first across all sources
    rows, meta = paginate(request, base, params, order_fragment=' ORDER BY created_at DESC')
    # Rename fields to stable keys for the client
    for r in rows:
        r['type'] = r.pop('rtype', r.get('type'))
        r['id'] = r.pop('rid', r.get('id'))
    return JsonResponse({'results': rows, **meta})


@api_view(require_auth=True, methods=['GET'], csrf=False)
def crisis_blood_inventory_summary(request: HttpRequest, crisis_id: int, _user=None):
    """List blood banks enlisted in the crisis and summarize their current inventory per blood type.

    Visibility: Admins or users who are participants of the incident linked to the crisis.
    Output: results: [ { bank_user_id, bank_name, bank_email, inventory: { 'A+': n, ... } } ]
    """
    _ensure_crisis_tables(); _ensure_blood_bank_tables()
    ok, err = _require_crisis_open(crisis_id)
    if not ok:
        return err
    cr = query("SELECT incident_id FROM crises WHERE id=%s", [crisis_id])
    if not cr:
        return JsonResponse({'results': []})
    is_admin = _require_admin(_user)
    if not is_admin:
        # Allow incident participants OR enrolled victims of this crisis
        part = query("SELECT id FROM incident_participants WHERE incident_id=%s AND user_id=%s AND status='active'", [cr['incident_id'], _user['id']])
        if not part:
            vic = query("SELECT id FROM crisis_victims WHERE crisis_id=%s AND user_id=%s", [crisis_id, _user['id']])
            if not vic:
                return JsonResponse({'error':'forbidden'}, status=403)
    # Find blood bank users participating in this incident
        banks = query(
                """
                SELECT ip.user_id AS bank_user_id, u.full_name AS bank_name, u.email AS bank_email
                FROM incident_participants ip
                JOIN users u ON u.id = ip.user_id
                WHERE ip.incident_id=%s AND ip.status='active'
                    AND (
                        LOWER(u.role) LIKE 'blood%%' OR LOWER(u.role)='blood_bank' OR
                        LOWER(ip.role_label) LIKE 'blood%%' OR LOWER(ip.role_label)='blood_bank'
                    )
                ORDER BY bank_name ASC
                """,
                [cr['incident_id']], many=True
        ) or []
    # Load inventory rows for these banks in one shot
    result = []
    if not banks:
        return JsonResponse({'results': result})
    ids = [int(b['bank_user_id']) for b in banks if b and b.get('bank_user_id')]
    if not ids:
        return JsonResponse({'results': result})
    placeholders = ",".join(["%s"] * len(ids))
    inv_rows = query(
        f"SELECT bank_user_id,blood_type,quantity_units FROM blood_inventory WHERE bank_user_id IN ({placeholders})",
        ids, many=True
    ) or []
    by_bank = {int(b['bank_user_id']): {'bank_user_id': int(b['bank_user_id']), 'bank_name': b.get('bank_name'), 'bank_email': b.get('bank_email'), 'inventory': {}} for b in banks}
    for r in inv_rows:
        try:
            bid = int(r['bank_user_id']); bt = (r['blood_type'] or '').upper().strip(); qty = int(r['quantity_units'] or 0)
            if bid in by_bank and bt:
                by_bank[bid]['inventory'][bt] = qty
        except Exception:
            continue
    # Ensure all blood types exist with 0 for easier UI rendering
    for entry in by_bank.values():
        inv = entry['inventory']
        for bt in ('A+','A-','B+','B-','O+','O-','AB+','AB-'):
            if bt not in inv:
                inv[bt] = 0
        result.append(entry)
    return JsonResponse({'results': result})


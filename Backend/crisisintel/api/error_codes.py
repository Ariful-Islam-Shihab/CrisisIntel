"""Centralized API error code catalog.

Each entry maps an error code to default HTTP status and human-friendly detail.
Detail strings kept concise; frontend can override with localized text.
"""

ERROR_CODES = {
    'missing_fields':        {'http': 400, 'detail': 'Required field(s) missing.'},
    'invalid_credentials':   {'http': 401, 'detail': 'Email or password is incorrect.'},
    'rate_limited':          {'http': 429, 'detail': 'Rate limit exceeded.'},
    'password_too_short':    {'http': 400, 'detail': 'Password too short.'},
    'password_weak':         {'http': 400, 'detail': 'Password must include a digit or symbol.'},
    'registration_failed':   {'http': 400, 'detail': 'Registration failed.'},
    'forbidden':             {'http': 403, 'detail': 'Action not permitted.'},
    'not_found':             {'http': 404, 'detail': 'Resource not found.'},
    'auth_required':         {'http': 401, 'detail': 'Authentication required.'},
    'method_not_allowed':    {'http': 405, 'detail': 'HTTP method not allowed.'},
    'invalid_status':        {'http': 400, 'detail': 'Invalid status value.'},
    'already_participating': {'http': 400, 'detail': 'Already participating.'},
    'invalid_transition':    {'http': 400, 'detail': 'Status transition not allowed.'},
}

def get_error_spec(code: str):
    return ERROR_CODES.get(code, None)

__all__ = ['ERROR_CODES', 'get_error_spec']

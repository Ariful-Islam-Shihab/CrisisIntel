import time
from .db import execute

class APIMetricsMiddleware:
    """Lightweight breadth-first metrics collector.

    Captures duration and basic request metadata into api_metrics table.
    Swallows all errors so it never blocks a response.
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        start = time.time()
        response = self.get_response(request)
        try:
            dur = int((time.time() - start) * 1000)
            path = request.path[:255]
            method = request.method[:8]
            status = getattr(response, 'status_code', 0)
            user_id = getattr(getattr(request, 'user', None), 'id', None)
            # Insert best-effort (ignore if table missing in early dev DB)
            try:
                execute("INSERT INTO api_metrics(path,method,status_code,duration_ms,user_id) VALUES(%s,%s,%s,%s,%s)", [path, method, status, dur, user_id])
            except Exception:
                pass
        except Exception:
            pass
        return response

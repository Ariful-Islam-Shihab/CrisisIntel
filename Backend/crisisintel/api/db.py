"""Raw SQL helper utilities.

We intentionally avoid Django's ORM for this project (requirement: *"only can use sql
queries, NO ORM"*). These helpers provide a very thin, explicit layer over the
`mysqlclient` DB-API via Django's configured `connection` object.

Design notes:
    * No implicit model mapping – callers must write full SQL including joins.
    * Param binding: always pass parameters separately to prevent SQL injection.
    * `query` returns either:
        - a single dict (column -> value) when exactly one row AND many=False
        - a list of dicts otherwise (zero rows => empty list)
        - None when the statement produced no result set (e.g. UPDATE w/o RETURNING)
    * `execute` is for INSERT / UPDATE / DELETE where returned rows are not needed;
      it returns the DB driver's `lastrowid` (useful after INSERT with auto PK).

Edge cases / cautions:
    * If you expect possibly zero or more rows, call with `many=True` to avoid
      accidentally receiving a single dict when only one row matches.
    * MySQL returns `lastrowid` only for tables with an AUTO_INCREMENT primary key.
    * Always validate untrusted user input before forming dynamic SQL fragments.
"""

from django.db import connection
from typing import Any, Iterable, List, Dict, Union, Optional


def query(sql: str, params: Optional[Iterable[Any]] = None, many: bool = False) -> Union[Dict[str, Any], List[Dict[str, Any]], None]:
    """Execute a SELECT (or any statement returning rows) and shape rows as dicts.

    Args:
        sql: Raw SQL string with %s placeholders for parameters.
        params: Iterable of parameter values (None => empty list).
        many: If True, always return a list; if False and exactly one row was
              returned, return that single row dict directly.

    Returns:
        dict: Single row (when one row AND many=False)
        list[dict]: List of row dicts (many=True OR result size != 1)
        None: When the executed statement produced no cursor.description (e.g. DDL)
    """
    with connection.cursor() as cur:
        cur.execute(sql, params or [])
        if cur.description:  # Cursor has a result set
            rows = cur.fetchall()
            columns = [col[0] for col in cur.description]
            # Convert tuples to dictionaries for ergonomic access in views
            result = [dict(zip(columns, r)) for r in rows]
            # Return single row directly unless caller requested list semantics
            return result if many or len(result) != 1 else result[0]
        # Statements like INSERT/UPDATE without RETURNING produce no description
        return None


def execute(sql: str, params: Optional[Iterable[Any]] = None) -> int:
    """Execute a data-modifying statement (INSERT / UPDATE / DELETE).

    Args:
        sql: SQL with %s placeholders.
        params: Iterable of parameter values.

    Returns:
        int: The database driver's reported lastrowid (0 if not applicable). Useful
             mainly for INSERT into AUTO_INCREMENT tables.
    """
    with connection.cursor() as cur:
        cur.execute(sql, params or [])
        return cur.lastrowid

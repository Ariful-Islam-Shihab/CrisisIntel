import React from 'react';

/** Card wrapper with optional header slots */
export default function Card({ title, subtitle, actions, children, className='', tight=false, footer }) {
  return (
    <div className={`card ${tight ? 'tight' : ''} ${className}`.trim()}>
      {(title || actions) && (
        <div className="card-header">
          <div>
            {title && <div className="card-title">{title}</div>}
            {subtitle && <div className="card-sub">{subtitle}</div>}
          </div>
          {actions && <div className="card-actions inline gap-2">{actions}</div>}
        </div>
      )}
      <div>{children}</div>
      {footer && <div className="card-footer mt-3">{footer}</div>}
    </div>
  );
}

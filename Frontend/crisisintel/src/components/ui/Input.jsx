import React from 'react';

/** Generic text input with label + error */
export default function Input({ label, error, className = '', inline = false, hint, ...rest }) {
  return (
    <div className={`field ${inline ? 'inline' : ''} ${className}`}> 
      {label && <label>{label}</label>}
      <input className={`input ${error ? 'error' : ''}`} {...rest} />
      {hint && !error && <div className="hint">{hint}</div>}
      {error && <div className="hint" style={{color:'var(--color-danger)'}}>{error}</div>}
    </div>
  );
}

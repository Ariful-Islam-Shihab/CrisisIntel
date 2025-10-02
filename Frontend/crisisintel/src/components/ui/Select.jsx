import React from 'react';

export default function Select({ label, error, options = [], className='', inline=false, hint, ...rest }) {
  return (
    <div className={`field ${inline ? 'inline' : ''} ${className}`}> 
      {label && <label>{label}</label>}
      <select className={`input ${error ? 'error' : ''}`} {...rest}>
        {options.map(o => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && !error && <div className="hint">{hint}</div>}
      {error && <div className="hint" style={{color:'var(--color-danger)'}}>{error}</div>}
    </div>
  );
}

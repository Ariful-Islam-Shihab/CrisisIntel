import React from 'react';

/**
 * Reusable Button component
 * Props: variant (primary|danger|outline|ghost|default), size (sm|md), block, loading, disabled, icon, children, ...rest
 */
export default function Button({
  variant = 'default',
  size = 'md',
  block = false,
  loading = false,
  disabled = false,
  icon = null,
  children,
  className = '',
  ...rest
}) {
  const classes = ['btn'];
  if (variant && variant !== 'default') classes.push(variant);
  if (size === 'sm') classes.push('sm');
  if (block) classes.push('block');
  if (className) classes.push(className);
  return (
    <button className={classes.join(' ')} disabled={disabled || loading} {...rest}>
      {loading && <span className="spinner" style={{width:14,height:14,border:'2px solid rgba(255,255,255,0.6)',borderTopColor:'#fff',borderRadius:'50%',display:'inline-block',animation:'spin .7s linear infinite'}} />}
      {icon && <span className="btn-icon">{icon}</span>}
      <span>{children}</span>
    </button>
  );
}

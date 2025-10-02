import React from 'react';

export default function Badge({ children, variant='default', className='', ...rest }) {
  const classes = ['badge'];
  if (variant !== 'default') classes.push(variant);
  if (className) classes.push(className);
  return <span className={classes.join(' ')} {...rest}>{children}</span>;
}
